// Survey Mode capture loop. Unlike the mining loop (one region → vote → match →
// push to overlay), this OCRs several regions per tick and routes each by its
// role: `rs` → the ore matcher, `shipPos` → the debug-overlay coordinate parser,
// `system` → the system-name parser. Unchanged crops skip OCR (per region).
//
// Phase S1 shows the latest parse live so coordinate reads can be verified on a
// real HUD (the human checkpoint). Stability/voting and logging come in S3.

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { hashPixels, matchOre, parsePos, parseScanResult, parseSystemName } from '../core';
import type { OreCandidate, ScanResult, SignatureTable, Vec3 } from '../core';
import { preprocess } from './preprocess';
import type { DrawableSource, NormRegion } from './preprocess';
import { recognize } from './ocr';
import { pickReading } from './useCaptureLoop';
import type { LoopParams } from './useCaptureLoop';
import type { SurveyRole } from '../shared/bridge';

/** A region the loop should read this tick. */
export interface ActiveSurveyRegion {
  id: string;
  role: SurveyRole;
  rect: NormRegion;
  /** Per-region upscale override; falls back to the global upscale when unset. */
  scale?: number;
}

/** Per-region debug surfaced in the Survey panel (aids the OCR checkpoint). */
export interface RegionDebug {
  role: SurveyRole;
  dataUrl: string | null;
  rawText: string;
  parsed: string;
  ok: boolean;
  /** OCR mean confidence of the best detected line (0..1). */
  score?: number;
  /** recognize() wall time in ms (0 on a cache-skipped frame). */
  ms?: number;
  /** Number of text lines PP-OCR detected in the crop. */
  lineCount?: number;
}

/** OCR stats for the RS region, surfaced in the status footer + overlay. */
export interface OcrStat {
  /** Best detected-line confidence (0..1). */
  score: number;
  /** recognize() wall time in ms. */
  ms: number;
  /** Detected text-line count. */
  lineCount: number;
  /** Raw detected text (joined lines). */
  rawText: string;
}

/** Aggregated live readout across all roles. */
export interface SurveyReadout {
  rs: number | null;
  candidates: OreCandidate[];
  pos: Vec3 | null;
  posZone: string | null;
  system: string | null;
  scan: ScanResult | null;
  regions: Record<string, RegionDebug>;
  /** OCR stats for the RS region (null until one is read). */
  ocr: OcrStat | null;
  error: string | null;
}

const EMPTY: SurveyReadout = {
  rs: null,
  candidates: [],
  pos: null,
  posZone: null,
  system: null,
  scan: null,
  regions: {},
  ocr: null,
  error: null,
};

/** Cached per-region OCR result, reused when the crop is unchanged. */
interface Cached {
  hash: number;
  role: SurveyRole;
  dataUrl: string;
  rawText: string;
  rs: number | null;
  pos: { zone: string; pos: Vec3 } | null;
  system: string | null;
  scan: ScanResult | null;
  /** OCR stats from the last real recognize() (carried across cache hits). */
  score: number;
  ms: number;
  lineCount: number;
}

// OCR backoff: once a region's parsed result repeats this many times, it's
// "stable" and we stop re-running inference every tick — over a live game the
// crop's *background* changes every frame, so the exact-pixel cache almost
// never skips and OCR would otherwise run forever, ramping WebGPU memory until
// it stalls. While stable we re-OCR at most every STABLE_INTERVAL_MS (a
// heartbeat that still catches a genuine change), reusing the last result and
// refreshing the crop so the preview stays live.
const STABLE_RUNS = 3;
const STABLE_INTERVAL_MS = 1000;

/** Per-region backoff bookkeeping. */
interface StableMeta {
  /** A key identifying the parsed result (so we know when it changed). */
  key: string;
  /** How many consecutive OCR runs produced this key. */
  runs: number;
  /** performance.now() of the last real recognize() for this region. */
  at: number;
}

/** Format a position vector in km for the debug line (full precision). */
function fmtKm(p: Vec3): string {
  const km = (m: number): string => (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 4 });
  return `${km(p.x)}, ${km(p.y)}, ${km(p.z)} km`;
}

export function useSurveyCapture(
  mediaRef: RefObject<DrawableSource | null>,
  regions: ActiveSurveyRegion[],
  params: LoopParams,
  enabled: boolean,
  table: SignatureTable,
): SurveyReadout {
  const [state, setState] = useState<SurveyReadout>(EMPTY);
  const busy = useRef(false);
  const cache = useRef<Map<string, Cached>>(new Map());
  const stableMeta = useRef<Map<string, StableMeta>>(new Map());
  const regionsRef = useRef(regions);
  regionsRef.current = regions;

  const { scale, intervalMs, minConfidence } = params;
  const minConf = minConfidence ?? 0;
  // Restart the loop when the set/role/rect of regions changes.
  const regionsKey = regions
    .map((r) => `${r.id}:${r.role}:${r.scale ?? ''}:${r.rect.x},${r.rect.y},${r.rect.w},${r.rect.h}`)
    .join('|');

  useEffect(() => {
    if (!enabled) return;
    cache.current = new Map();
    stableMeta.current = new Map();
    let cancelled = false;

    const tick = async (): Promise<void> => {
      const media = mediaRef.current;
      const current = regionsRef.current;
      if (!media || busy.current || current.length === 0) return;

      busy.current = true;
      try {
        const next = new Map<string, Cached>();
        for (const reg of current) {
          const pre = preprocess(media, reg.rect, { scale: reg.scale ?? scale });
          if (!pre) continue;
          const hash = hashPixels(pre.pixels);
          const prev = cache.current.get(reg.id);
          if (prev && prev.hash === hash && prev.role === reg.role) {
            next.set(reg.id, { ...prev, dataUrl: pre.dataUrl });
            continue;
          }
          // Backoff: result has been stable, so skip inference within the
          // heartbeat — reuse the last result, refresh hash + crop. Bounds
          // WebGPU work over a live game whose background churns every frame.
          const meta = stableMeta.current.get(reg.id);
          const nowMs = performance.now();
          if (
            prev &&
            prev.role === reg.role &&
            meta &&
            meta.runs >= STABLE_RUNS &&
            nowMs - meta.at < STABLE_INTERVAL_MS
          ) {
            next.set(reg.id, { ...prev, hash, dataUrl: pre.dataUrl });
            continue;
          }
          const t0 = performance.now();
          const lines = await recognize(pre.dataUrl);
          const ms = Math.round(performance.now() - t0);
          if (cancelled) return;
          const texts = lines.map((l) => l.text);
          const rawText = texts.length ? texts.join(' | ') : '(no text)';
          const score = lines.reduce((m, l) => Math.max(m, l.score), 0);
          const lineCount = lines.length;

          let rs: number | null = null;
          let pos: { zone: string; pos: Vec3 } | null = null;
          let system: string | null = null;
          let scan: ScanResult | null = null;
          if (reg.role === 'rs') {
            // Confidence gate: a low-confidence frame is treated as no-reading
            // (null) so clear garbage never reaches the voter. The score is the
            // best detected line's confidence.
            rs = score >= minConf ? pickReading(lines, table) : null;
          } else if (reg.role === 'shipPos') {
            // parsePos anchors on the SolarSystem frame across however many zone
            // rows the box caught, and flattens the lines itself.
            pos = parsePos(texts.join('\n'));
          } else if (reg.role === 'scanResult') {
            scan = parseScanResult(texts.join('\n'));
          } else {
            system = parseSystemName(texts.join(' '));
          }
          next.set(reg.id, { hash, role: reg.role, dataUrl: pre.dataUrl, rawText, rs, pos, system, scan, score, ms, lineCount });
          // Track result stability to drive the backoff above.
          const key =
            reg.role === 'rs'
              ? `rs:${rs}`
              : reg.role === 'scanResult'
                ? `scan:${scan ? `${scan.ore}/${scan.composition.length}` : ''}`
                : reg.role === 'shipPos'
                  ? `pos:${pos ? pos.zone : ''}`
                  : `sys:${system ?? ''}`;
          const runs = meta && meta.key === key ? meta.runs + 1 : 1;
          stableMeta.current.set(reg.id, { key, runs, at: performance.now() });
        }
        cache.current = next;
        if (cancelled) return;

        let rs: number | null = null;
        let pos: Vec3 | null = null;
        let posZone: string | null = null;
        let system: string | null = null;
        let scan: ScanResult | null = null;
        let ocr: OcrStat | null = null;
        const regionsDebug: Record<string, RegionDebug> = {};
        for (const reg of current) {
          const c = next.get(reg.id);
          if (!c) {
            regionsDebug[reg.id] = { role: reg.role, dataUrl: null, rawText: '(not ready)', parsed: '—', ok: false };
            continue;
          }
          let parsed = '—';
          let ok = false;
          if (c.role === 'rs') {
            // Surface RS OCR stats whether or not the reading matched an ore.
            ocr = { score: c.score, ms: c.ms, lineCount: c.lineCount, rawText: c.rawText };
            if (c.rs != null) {
              rs = c.rs;
              parsed = String(c.rs);
              ok = true;
            } else parsed = 'no match';
          } else if (c.role === 'shipPos') {
            if (c.pos) {
              pos = c.pos.pos;
              posZone = c.pos.zone || null;
              parsed = fmtKm(c.pos.pos);
              ok = true;
            } else parsed = 'no coords';
          } else if (c.role === 'scanResult') {
            if (c.scan) {
              scan = c.scan;
              parsed = `${c.scan.ore} · ${c.scan.composition.length} mat`;
              ok = true;
            } else parsed = 'no scan';
          } else if (c.system) {
            system = c.system;
            parsed = c.system;
            ok = true;
          }
          regionsDebug[reg.id] = { role: c.role, dataUrl: c.dataUrl, rawText: c.rawText, parsed, ok, score: c.score, ms: c.ms, lineCount: c.lineCount };
        }
        const candidates = rs != null ? matchOre(rs, table, { method: 'Ship' }) : [];
        setState({ rs, candidates, pos, posZone, system, scan, regions: regionsDebug, ocr, error: null });
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
        }
      } finally {
        busy.current = false;
      }
    };

    const id = window.setInterval(() => void tick(), Math.max(200, intervalMs));
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaRef, scale, intervalMs, minConf, enabled, table, regionsKey]);

  return state;
}

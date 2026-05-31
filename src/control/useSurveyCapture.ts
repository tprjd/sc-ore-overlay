// Survey Mode capture loop. Unlike the mining loop (one region → vote → match →
// push to overlay), this OCRs several regions per tick and routes each by its
// role: `rs` → the ore matcher, `shipPos` → the debug-overlay coordinate parser,
// `system` → the system-name parser. Unchanged crops skip OCR (per region).
//
// Phase S1 shows the latest parse live so coordinate reads can be verified on a
// real HUD (the human checkpoint). Stability/voting and logging come in S3.

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { hashPixels, matchOre, parsePos, parseSystemName } from '../core';
import type { OreCandidate, SignatureTable, Vec3 } from '../core';
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
}

/** Per-region debug surfaced in the Survey panel (aids the OCR checkpoint). */
export interface RegionDebug {
  role: SurveyRole;
  dataUrl: string | null;
  rawText: string;
  parsed: string;
  ok: boolean;
}

/** Aggregated live readout across all roles. */
export interface SurveyReadout {
  rs: number | null;
  candidates: OreCandidate[];
  pos: Vec3 | null;
  posZone: string | null;
  system: string | null;
  regions: Record<string, RegionDebug>;
  error: string | null;
}

const EMPTY: SurveyReadout = {
  rs: null,
  candidates: [],
  pos: null,
  posZone: null,
  system: null,
  regions: {},
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
}

/** Format a position vector in km for the debug line. */
function fmtKm(p: Vec3): string {
  const km = (m: number): string => (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
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
  const regionsRef = useRef(regions);
  regionsRef.current = regions;

  const { scale, intervalMs } = params;
  // Restart the loop when the set/role/rect of regions changes.
  const regionsKey = regions
    .map((r) => `${r.id}:${r.role}:${r.rect.x},${r.rect.y},${r.rect.w},${r.rect.h}`)
    .join('|');

  useEffect(() => {
    if (!enabled) return;
    cache.current = new Map();
    let cancelled = false;

    const tick = async (): Promise<void> => {
      const media = mediaRef.current;
      const current = regionsRef.current;
      if (!media || busy.current || current.length === 0) return;

      busy.current = true;
      try {
        const next = new Map<string, Cached>();
        for (const reg of current) {
          const pre = preprocess(media, reg.rect, { scale });
          if (!pre) continue;
          const hash = hashPixels(pre.pixels);
          const prev = cache.current.get(reg.id);
          if (prev && prev.hash === hash && prev.role === reg.role) {
            next.set(reg.id, { ...prev, dataUrl: pre.dataUrl });
            continue;
          }
          const lines = await recognize(pre.dataUrl);
          if (cancelled) return;
          const texts = lines.map((l) => l.text);
          const rawText = texts.length ? texts.join(' | ') : '(no text)';

          let rs: number | null = null;
          let pos: { zone: string; pos: Vec3 } | null = null;
          let system: string | null = null;
          if (reg.role === 'rs') {
            rs = pickReading(lines, table);
          } else if (reg.role === 'shipPos') {
            // Newline-join first (lets parsePos prefer the SolarSystem line when
            // several zones are in view); fall back to a space-join for a single
            // line PP-OCR fragmented into pieces.
            pos = parsePos(texts.join('\n')) ?? parsePos(texts.join(' '));
          } else {
            system = parseSystemName(texts.join(' '));
          }
          next.set(reg.id, { hash, role: reg.role, dataUrl: pre.dataUrl, rawText, rs, pos, system });
        }
        cache.current = next;
        if (cancelled) return;

        let rs: number | null = null;
        let pos: Vec3 | null = null;
        let posZone: string | null = null;
        let system: string | null = null;
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
          } else if (c.system) {
            system = c.system;
            parsed = c.system;
            ok = true;
          }
          regionsDebug[reg.id] = { role: c.role, dataUrl: c.dataUrl, rawText: c.rawText, parsed, ok };
        }
        const candidates = rs != null ? matchOre(rs, table, { method: 'Ship' }) : [];
        setState({ rs, candidates, pos, posZone, system, regions: regionsDebug, error: null });
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
  }, [mediaRef, scale, intervalMs, enabled, table, regionsKey]);

  return state;
}

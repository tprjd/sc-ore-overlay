// Debug helper: OCR a still image through the currently-configured Survey
// regions and build a SurveyEntry — used to simulate other scouts logging scans
// from uploaded screenshots, before real live logging (S3) and networking (S4).
// Reuses the same OCR + parsers as the live loop, so a screenshot must have the
// debug overlay visible in the same layout the regions were drawn for. Returns
// per-region debug (crop + raw text + parsed value) so misreads/misaligned
// boxes are visible.

import { makeEntry, matchOre, parsePos, parseScanResult, parseSystemName } from '../core';
import type { ScanResult, SignatureTable, SurveyEntry, Vec3 } from '../core';
import { preprocess } from './preprocess';
import { recognize } from './ocr';
import { pickReading } from './useCaptureLoop';
import type { ActiveSurveyRegion } from './useSurveyCapture';
import type { SurveyRole } from '../shared/bridge';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load'));
    img.src = url;
  });
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const fmtKm = (p: Vec3): string => {
  const km = (m: number): string => (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return `${km(p.x)}, ${km(p.y)}, ${km(p.z)} km`;
};

/** Per-region debug for one scanned image. */
export interface SimRegionDebug {
  role: SurveyRole;
  dataUrl: string | null;
  rawText: string;
  parsed: string;
  ok: boolean;
}

/** Result of scanning one uploaded image. */
export interface SimScan {
  name: string;
  entry: SurveyEntry | null;
  regions: SimRegionDebug[];
  error?: string;
}

/** OCR one image file through the regions and assemble a peer SurveyEntry. */
export async function scanImage(
  file: File,
  regions: ActiveSurveyRegion[],
  table: SignatureTable,
  scout: string,
  scale: number,
): Promise<SimScan> {
  const url = URL.createObjectURL(file);
  const debugs: SimRegionDebug[] = [];
  try {
    const img = await loadImage(url);
    let rs: number | null = null;
    let pos: Vec3 | null = null;
    let system: string | null = null;
    let scan: ScanResult | null = null;

    for (const reg of regions) {
      const pre = preprocess(img, reg.rect, { scale: reg.scale ?? scale });
      if (!pre) {
        debugs.push({ role: reg.role, dataUrl: null, rawText: '(no crop)', parsed: '—', ok: false });
        continue;
      }
      const lines = await recognize(pre.dataUrl);
      const texts = lines.map((l) => l.text);
      const rawText = texts.length ? texts.join(' | ') : '(no text)';
      let parsed = '—';
      let ok = false;
      if (reg.role === 'rs') {
        rs = pickReading(lines, table);
        parsed = rs != null ? String(rs) : 'no match';
        ok = rs != null;
      } else if (reg.role === 'shipPos') {
        const p = parsePos(texts.join('\n'));
        pos = p?.pos ?? null;
        parsed = p ? fmtKm(p.pos) : 'no coords';
        ok = p != null;
      } else if (reg.role === 'scanResult') {
        scan = parseScanResult(texts.join('\n'));
        parsed = scan ? `${scan.ore} · ${scan.composition.length} mat` : 'no scan';
        ok = scan != null;
      } else {
        system = parseSystemName(texts.join(' '));
        parsed = system ?? '—';
        ok = system != null;
      }
      debugs.push({ role: reg.role, dataUrl: pre.dataUrl, rawText, parsed, ok });
    }

    if (!pos) {
      const why = regions.some((r) => r.role === 'shipPos')
        ? 'coordinates did not parse'
        : 'no Ship Pos region';
      return { name: scout, entry: null, regions: debugs, error: why };
    }
    const candidates = rs != null ? matchOre(rs, table, { method: 'Ship' }) : [];
    return {
      name: scout,
      regions: debugs,
      entry: makeEntry({
        id: newId(),
        ts: Date.now(),
        scout,
        system: system ?? 'NyxSolarSystem',
        pos,
        rs: rs ?? 0,
        candidates,
        scan: scan ?? undefined,
        source: 'peer',
      }),
    };
  } catch (err) {
    return { name: scout, entry: null, regions: debugs, error: err instanceof Error ? err.message : String(err) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Parse Star Citizen's "SCAN RESULTS" panel — the readout shown after scanning a
// rock. Unlike the RS signature (which is *inferred* into an ore via constrained
// division), this panel states the ore and its composition directly, so it's the
// ground truth for what a rock yields. Pure and testable; the caller feeds in the
// OCR text (one detected line per text line).
//
// Layout (from a real panel):
//
//   SCAN RESULTS
//   IRON (ORE) [CF]
//   MASS:        35111
//   RESISTANCE:  0%
//   INSTABILITY: 42.24
//   COMPOSITION  37.51 SCU
//   12.55%  IRON (ORE) [CF]    664
//   68.20%  IRON (ORE) [CF]    325
//   19.23%  INERT MATERIALS    0

/** One row of the rock's content breakdown. */
export interface ScanComposition {
  /** Material name as shown, e.g. "IRON (ORE) [CF]" or "INERT MATERIALS". */
  material: string;
  /** Percentage of the rock (0..100). */
  percent: number;
  /** Per-material quality (the trailing number on the row). */
  quality: number;
  /** This material's volume in SCU (percent × total SCU); set when SCU is known. */
  scu?: number;
}

/**
 * The structured SCAN RESULTS panel: the rock's properties (mass / resistance /
 * instability / SCU) plus its composition (what the rock contains, with the
 * per-material quality).
 */
export interface ScanResult {
  /** Cleaned ore name, e.g. "Iron". */
  ore: string;
  /** Raw ore line as scanned, e.g. "IRON (ORE) [CF]". */
  oreRaw: string;
  mass?: number;
  /** Resistance percentage (0..100). */
  resistance?: number;
  instability?: number;
  /** Total volume in SCU. */
  scu?: number;
  composition: ScanComposition[];
}

const LABEL = /^(mass|resistance|instability|composition|scan\s*results?)\b/i;

const num = (s: string): number => Number.parseFloat(s.replace(/,/g, ''));

function matchNum(text: string, re: RegExp): number | undefined {
  const m = re.exec(text);
  if (!m) return undefined;
  const v = num(m[1]);
  return Number.isFinite(v) ? v : undefined;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Drop "(ORE)" / "[CF]" / "【Cf】" style tags + collapse whitespace. Covers ASCII
 * parens/brackets *and* the unicode lookalikes OCR sometimes produces for the
 * SC HUD's stylized brackets ("【", "】"). Unmatched openers/closers are also
 * stripped so OCR garbage like "Titanium【Cf)" doesn't leak into the output.
 */
function stripTags(raw: string): string {
  return raw
    // Matched bracket pairs (ASCII or unicode) → drop content.
    .replace(/[([【（［].*?[)\]】）］]/g, '')
    // Unmatched opener — drop the opener and everything after it on the line.
    .replace(/[([【（］［].*$/g, '')
    // Lone closing brackets that leaked in — drop the char only; rely on the
    // snap-to-vocab Levenshtein step to absorb any junk letters left over
    // (e.g. "Titaniumicf)" → "Titaniumicf" → snap → "Titanium").
    .replace(/[)\]】）］]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip tags and title-case, e.g. "IRON (ORE) [CF]" → "Iron". */
function cleanOre(raw: string): string {
  return titleCase(stripTags(raw));
}

/**
 * Display-cleanup for a composition material name. Drops "(ORE)"/"[CF]" tags
 * and title-cases; "INERT MATERIALS" → "Inert". Keeps the original string when
 * stripping would leave nothing (so OCR garbage is still visible).
 */
export function cleanMaterial(raw: string): string {
  if (/\binert\b/i.test(raw)) return 'Inert';
  const c = stripTags(raw);
  return c ? titleCase(c) : raw;
}

/** Damerau-free Levenshtein distance, classic DP. Small strings → fine to allocate. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

const letters = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Snap an OCR'd material name to the nearest known ore from `vocab`, or to
 * "Inert" if the raw contains "inert". Compares letter-only lowercased forms
 * by Levenshtein and accepts a match within `max(2, ceil(len × 0.3))` edits —
 * enough to absorb single-letter swaps ("Agricius" → "Agricium") and tag
 * leakage ("Titaniumicf" → "Titanium") without snapping random words to ores.
 * Falls back to a cleaned/title-cased version of the raw when no candidate is
 * close enough, so OCR garbage is still visible (not silently rewritten).
 */
export function snapMaterial(raw: string, vocab: readonly string[]): string {
  if (/\binert\b/i.test(raw) || /^inert/i.test(letters(raw))) return 'Inert';
  const cleaned = stripTags(raw);
  if (!cleaned) return raw;
  const target = letters(cleaned);
  if (!target) return raw;
  let best: { name: string; dist: number } | null = null;
  for (const v of vocab) {
    const d = levenshtein(target, letters(v));
    if (!best || d < best.dist) best = { name: v, dist: d };
  }
  const threshold = Math.max(2, Math.ceil(target.length * 0.3));
  if (best && best.dist <= threshold) return best.name;
  return titleCase(cleaned);
}

/**
 * Parse the SCAN RESULTS panel text. Returns null when no ore line is present
 * (e.g. the region didn't capture the panel). Numeric fields are best-effort and
 * may be undefined if the OCR missed them; the ore + composition are the point.
 */
export function parseScanResult(text: string): ScanResult | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // The ore is the first line that isn't a label, a composition row, or the SCU
  // header — i.e. the bare ore name under the "SCAN RESULTS" title.
  let oreRaw: string | null = null;
  for (const l of lines) {
    if (LABEL.test(l)) continue;
    if (/scu/i.test(l)) continue;
    if (/^[\d.,]+\s*%/.test(l)) continue;
    if (!/[a-z]/i.test(l)) continue;
    oreRaw = l;
    break;
  }
  if (!oreRaw) return null;

  const scuTotal = matchNum(text, /([\d.]+)\s*scu/i);
  const composition: ScanComposition[] = [];
  for (const l of lines) {
    // A composition row is "<pct>% <material> <quality>". The quality is the
    // trailing digit run, which OCR often glues to the material (e.g.
    // "ASLARITE(RAW)[CF]287") — so don't require a separator. Rows whose quality
    // wasn't read (e.g. "INERT MATERIALS") are kept with quality 0.
    const m = /^([\d.,]+)\s*%\s*(.+)$/.exec(l);
    if (!m) continue;
    const percent = num(m[1]);
    if (!Number.isFinite(percent)) continue;
    const rest = m[2].trim();
    const q = /(\d[\d.,]*)\s*$/.exec(rest);
    const quality = q ? num(q[1]) : 0;
    const material = (q ? rest.slice(0, q.index) : rest).trim();
    composition.push({
      percent,
      material,
      quality,
      scu: scuTotal != null ? (percent / 100) * scuTotal : undefined,
    });
  }

  return {
    ore: cleanOre(oreRaw),
    oreRaw,
    mass: matchNum(text, /mass\s*:?\s*([\d,.]+)/i),
    resistance: matchNum(text, /resistance\s*:?\s*([\d.]+)\s*%?/i),
    instability: matchNum(text, /instability\s*:?\s*([\d.]+)/i),
    scu: scuTotal,
    composition,
  };
}

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

/** Strip "(ORE)"/"[CF]"-style tags and title-case, e.g. "IRON (ORE) [CF]" → "Iron". */
function cleanOre(raw: string): string {
  return titleCase(
    raw
      .replace(/\(.*?\)/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
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

  const composition: ScanComposition[] = [];
  for (const l of lines) {
    const m = /^([\d.,]+)\s*%\s*(.+?)\s+([\d.,]+)\s*$/.exec(l);
    if (m) composition.push({ percent: num(m[1]), material: m[2].trim(), quality: num(m[3]) });
  }

  return {
    ore: cleanOre(oreRaw),
    oreRaw,
    mass: matchNum(text, /mass\s*:?\s*([\d,.]+)/i),
    resistance: matchNum(text, /resistance\s*:?\s*([\d.]+)\s*%?/i),
    instability: matchNum(text, /instability\s*:?\s*([\d.]+)/i),
    scu: matchNum(text, /([\d.]+)\s*scu/i),
    composition,
  };
}

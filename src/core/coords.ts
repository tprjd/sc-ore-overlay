// Parse the ship's absolute position out of Star Citizen's debug diagnostic
// overlay (the `Zone: … Pos: x y z` readout the user enables in the in-game
// console). Pure and testable — no OCR, no DOM here; the caller feeds in the
// recognized text.
//
// The overlay prints several nested zone frames, innermost → outermost:
//
//   Zone: ARGO_MOLE_Teach_372772292218            Pos: -1.00m 20.15m 0.78m
//   Zone: glaciemring_segment_…                   Pos: 46.6484km 106.5163km 734.87m
//   Zone: SolarSystem_285626946665                Pos: -14215974.6126km -4787767.8108km 734.87m
//   Zone: Root                                    Pos: -14215974.6126km -4787767.8108km 734.87m
//
// We want the `SolarSystem_<id>` line: absolute, system-space coordinates that
// every scout in the same system shares. Units differ *per axis* (m vs km, and
// possibly Mm/Gm at larger scales), so each token is parsed with its own unit
// and normalized to **meters**.

/** A position in meters. Absolute (SolarSystem) frame unless noted. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A parsed position line: the zone it came from plus the position in meters. */
export interface PosReading {
  /** Zone name, e.g. "SolarSystem_285626946665" or "Root" ('' if unlabeled). */
  zone: string;
  /** Position in meters. */
  pos: Vec3;
}

/** Metric distance units the overlay uses → meters. */
const UNIT_TO_METERS: Record<string, number> = {
  m: 1,
  km: 1_000,
  Mm: 1_000_000,
  Gm: 1_000_000_000,
};

// A signed decimal with optional thousands separators and an optional metric
// unit. The unit alternation lists km before m so "…km" isn't read as "…k" + m.
const DIST_TOKEN = /([+\-−]?\d[\d,]*(?:\.\d+)?)\s*(Gm|Mm|km|m)?/g;
// "Pos" / "Pos:" anchor, and a leading "Zone:" label to strip.
const POS_ANCHOR = /\bpos\b\s*:?/i;
const ZONE_PREFIX = /^\s*zone\s*:?\s*/i;

/** Magnitude of a position vector (meters). */
function magnitude(p: Vec3): number {
  return Math.hypot(p.x, p.y, p.z);
}

/** Normalize a captured number string (strip commas/spaces, unify minus sign). */
function toNumber(raw: string): number {
  return Number.parseFloat(raw.replace(/[\s,]/g, '').replace(/−/g, '-'));
}

/**
 * Parse a single distance token (e.g. "-14215974.6126km", "734.87m", "20.15 m",
 * or a bare "20.15" treated as meters) into meters. Returns null when the token
 * isn't a number or carries an unrecognized unit.
 */
export function parseDistanceToken(token: string): number | null {
  const m = /^\s*([+\-−]?\d[\d,]*(?:\.\d+)?)\s*(Gm|Mm|km|m)?\s*$/.exec(token);
  if (!m) return null;
  const value = toNumber(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2] ?? '';
  const factor = unit === '' ? 1 : UNIT_TO_METERS[unit];
  if (factor == null) return null;
  return value * factor;
}

/**
 * Pull the first three distance values (meters) out of a text segment. When
 * `requireUnit` is set, only tokens carrying a metric unit count — this lets us
 * read the three coordinates off a line that also contains a bare numeric zone
 * id (e.g. "SolarSystem_285626946665") without grabbing the id.
 */
function extractTriple(segment: string, requireUnit: boolean): Vec3 | null {
  const out: number[] = [];
  for (const m of segment.matchAll(DIST_TOKEN)) {
    const unit = m[2];
    if (requireUnit && !unit) continue;
    const value = toNumber(m[1]);
    if (!Number.isFinite(value)) continue;
    const factor = unit ? UNIT_TO_METERS[unit] : 1;
    if (factor == null) continue;
    out.push(value * factor);
    if (out.length === 3) break;
  }
  if (out.length < 3) return null;
  return { x: out[0], y: out[1], z: out[2] };
}

/**
 * Parse one line of the overlay into a {zone, pos}. Prefers the "Pos:" anchor
 * (everything after it is the coordinate triple; everything before, minus a
 * "Zone:" label, is the zone name). With no anchor — e.g. the user boxed only
 * the numbers — it falls back to the unit-bearing tokens on the line. Returns
 * null when fewer than three coordinates are present.
 */
export function parsePosLine(line: string): PosReading | null {
  const anchor = POS_ANCHOR.exec(line);
  if (anchor) {
    const before = line.slice(0, anchor.index);
    const after = line.slice(anchor.index + anchor[0].length);
    const pos = extractTriple(after, false); // anchored: units optional
    if (!pos) return null;
    return { zone: before.replace(ZONE_PREFIX, '').trim(), pos };
  }
  const pos = extractTriple(line, true); // no anchor: require units
  if (!pos) return null;
  return { zone: '', pos };
}

/**
 * Parse the ship position from a block of overlay text (one or many lines).
 * Picks the most useful frame: the zone matching `preferZone` ("SolarSystem" by
 * default), else a "Root" line, else the largest-magnitude reading (the most
 * global frame). Returns null when no line yields three coordinates.
 */
export function parsePos(text: string, opts: { preferZone?: string } = {}): PosReading | null {
  const preferZone = (opts.preferZone ?? 'SolarSystem').toLowerCase();
  const readings: PosReading[] = [];
  for (const line of text.split(/\r?\n/)) {
    const r = parsePosLine(line);
    if (r) readings.push(r);
  }
  if (readings.length === 0) return null;

  const zoned = readings.find((r) => r.zone.toLowerCase().includes(preferZone));
  if (zoned) return zoned;
  const root = readings.find((r) => r.zone.toLowerCase().includes('root'));
  if (root) return root;
  return readings.reduce((best, r) => (magnitude(r.pos) > magnitude(best.pos) ? r : best));
}

/**
 * Parse the system name from the overlay's "Current player location : <name>"
 * line, or from a box that contains only the name. Returns the first token of
 * the value (e.g. "NyxSolarSystem"), or null when empty.
 */
export function parseSystemName(text: string): string | null {
  const labeled = /current\s+player\s+location\s*:?\s*(.+)$/im.exec(text);
  const raw = (labeled ? labeled[1] : text).trim();
  if (!raw) return null;
  return raw.split(/\s+/)[0] ?? null;
}

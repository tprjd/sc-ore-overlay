// Minimal semver comparison for the startup update check (electron/update.ts)
// and game-patch ordering (table loading). Compares numeric MAJOR.MINOR.PATCH,
// then applies SemVer §11 pre-release precedence so `-rc.N` tags order correctly
// (1.0.0 > 1.0.0-rc.2 > 1.0.0-rc.1). Kept in the framework-free core so it's
// unit-testable without Electron.

/** Parse "v1.2.3" / "1.2.3-rc.1" → [1, 2, 3]; missing/garbage parts become 0.
 *  Pre-release suffix is intentionally dropped here — it's the numeric core only;
 *  pre-release precedence is handled separately in isVersionNewer. */
export function parseVersion(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
}

/** Split "v1.2.3-rc.1" → ["1.2.3", "rc.1"]; no suffix → [core, undefined]. */
function splitPrerelease(v: string): [string, string | undefined] {
  const s = v.trim().replace(/^v/i, '');
  const i = s.indexOf('-');
  return i === -1 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)];
}

/** Compare dot-separated pre-release tags per SemVer §11. Returns >0 if `a`
 *  has higher precedence than `b`, <0 if lower, 0 if equal. A missing tag
 *  (a stable release) outranks any pre-release. */
function comparePrerelease(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1; // 1.0.0 > 1.0.0-rc.1
  if (b === undefined) return -1;
  const as = a.split('.');
  const bs = b.split('.');
  const len = Math.max(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const x = as[i];
    const y = bs[i];
    if (x === undefined) return -1; // fewer fields = lower precedence
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d > 0 ? 1 : -1;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1; // numeric identifiers rank lower than alphanumeric
    } else if (x !== y) {
      return x > y ? 1 : -1; // lexical
    }
  }
  return 0;
}

/** True when version `a` is strictly newer than `b`. */
export function isVersionNewer(a: string, b: string): boolean {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  // Numeric cores equal → pre-release precedence decides.
  const [, preA] = splitPrerelease(a);
  const [, preB] = splitPrerelease(b);
  return comparePrerelease(preA, preB) > 0;
}

// Minimal semver comparison for the startup update check (electron/update.ts).
// Compares only numeric MAJOR.MINOR.PATCH; any pre-release suffix is dropped.
// Kept here in the framework-free core so it's unit-testable without Electron.

/** Parse "v1.2.3" / "1.2.3-rc.1" → [1, 2, 3]; missing/garbage parts become 0. */
export function parseVersion(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
}

/** True when version `a` is strictly newer than `b` (numeric compare). */
export function isVersionNewer(a: string, b: string): boolean {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

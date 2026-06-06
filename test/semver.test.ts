import { describe, expect, it } from 'vitest';
import { isVersionNewer, parseVersion } from '../src/core/semver';

describe('parseVersion', () => {
  it('strips a leading v and splits on dots', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
  });
  it('drops a pre-release suffix', () => {
    expect(parseVersion('1.4.0-rc.1')).toEqual([1, 4, 0]);
  });
  it('coerces missing/garbage parts to 0', () => {
    expect(parseVersion('1.x.3')).toEqual([1, 0, 3]);
    expect(parseVersion('2')).toEqual([2]);
  });
});

describe('isVersionNewer', () => {
  it('detects a newer patch / minor / major', () => {
    expect(isVersionNewer('1.2.4', '1.2.3')).toBe(true);
    expect(isVersionNewer('1.3.0', '1.2.9')).toBe(true);
    expect(isVersionNewer('2.0.0', '1.9.9')).toBe(true);
  });
  it('is false for equal or older versions', () => {
    expect(isVersionNewer('1.2.3', '1.2.3')).toBe(false);
    expect(isVersionNewer('1.2.2', '1.2.3')).toBe(false);
    expect(isVersionNewer('1.0.0', '1.0.1')).toBe(false);
  });
  it('ignores a leading v on either side', () => {
    expect(isVersionNewer('v1.3.0', '1.2.0')).toBe(true);
    expect(isVersionNewer('1.2.0', 'v1.2.0')).toBe(false);
  });
  it('treats a longer version with trailing zeros as equal', () => {
    expect(isVersionNewer('1.2.0', '1.2')).toBe(false);
    expect(isVersionNewer('1.2', '1.2.0')).toBe(false);
  });
  it('orders pre-releases of the same core by SemVer precedence', () => {
    // The bug that hid rc.2 from rc.1 users: same numeric core must compare by suffix.
    expect(isVersionNewer('1.0.0-rc.2', '1.0.0-rc.1')).toBe(true);
    expect(isVersionNewer('1.0.0-rc.1', '1.0.0-rc.2')).toBe(false);
    expect(isVersionNewer('1.0.0-rc.10', '1.0.0-rc.2')).toBe(true); // numeric, not lexical
    expect(isVersionNewer('1.0.0-rc.1', '1.0.0-rc.1')).toBe(false);
  });
  it('ranks a stable release above any pre-release of the same core', () => {
    expect(isVersionNewer('1.0.0', '1.0.0-rc.2')).toBe(true);
    expect(isVersionNewer('1.0.0-rc.2', '1.0.0')).toBe(false);
  });
  it('lets a higher core beat a pre-release regardless of suffix', () => {
    expect(isVersionNewer('1.0.1-rc.1', '1.0.0')).toBe(true);
    expect(isVersionNewer('1.0.0-rc.1', '0.9.0')).toBe(true);
  });
});

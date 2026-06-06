// Lightweight startup update check.
//
// Deliberately NOT electron-updater: code signing is deferred and we don't want
// a publish pipeline yet, so this just asks the GitHub Releases API for the
// latest tag once, compares it to the running version, and lets the control
// window show a "new version" link. The user downloads/updates manually. This
// matters here because the signature table is patch-coupled (re-crawled per SC
// patch and shipped in app updates) — a stranded old build = stale ore data.
//
// One-shot, on demand from the renderer at startup — never on the per-scan hot
// path. Every failure (offline, rate-limit, no releases yet) is swallowed: an
// update check must never block or crash the app.

import { app, net } from 'electron';
import { isVersionNewer } from '../src/core/semver';
import type { UpdateInfo } from '../src/shared/bridge';
import { log } from './log';

const OWNER = 'tprjd';
const REPO = 'sc-ore-overlay';
// NOT /releases/latest — that endpoint excludes pre-releases, so while we ship
// rc/beta builds it 404s and the app reports "up to date" forever. List recent
// releases and take the newest published (non-draft) one, pre-releases included,
// so testers on an rc get notified of the next rc. (Once a stable release is the
// newest, it wins on SemVer precedence anyway; if you later want to hide
// pre-releases from non-testers, filter `!r.prerelease` here.)
const RELEASES_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=10`;
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const TIMEOUT_MS = 6000;

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion();
  const info: UpdateInfo = { current, latest: null, url: RELEASES_PAGE, available: false };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // net.fetch uses Chromium's network stack, so it honors system proxy config.
    const res = await net.fetch(RELEASES_API, {
      headers: {
        'User-Agent': `sc-ore-overlay/${current}`,
        Accept: 'application/vnd.github+json',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // 404 = no releases published yet; 403 = rate-limited. Neither is fatal.
      log.info(`[update] check: HTTP ${res.status}`);
      return info;
    }
    // GitHub returns releases newest-first; unauthenticated callers never see
    // drafts, but guard anyway. First published release wins.
    const list = (await res.json()) as Array<{
      tag_name?: string;
      html_url?: string;
      draft?: boolean;
    }>;
    const newest = Array.isArray(list) ? list.find((r) => !r.draft) : undefined;
    if (!newest) {
      log.info('[update] check: no published releases');
      return info;
    }
    info.latest = newest.tag_name ?? null;
    if (newest.html_url) info.url = newest.html_url;
    info.available = info.latest != null && isVersionNewer(info.latest, current);
    log.info(
      `[update] current=${current} latest=${info.latest ?? '?'} available=${info.available}`,
    );
  } catch (err) {
    log.info('[update] check failed:', err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
  return info;
}

// Runtime signature-table store (main process). Crawls the Star Citizen Wiki API
// into <userData>/tables/<patch>.json so ore data isn't tied to an app build, and
// resolves the crawled tables the renderer prefers over its bundled fallback.
//
// Sanctioned deviation from CLAUDE.md guardrail #2 ("build-time crawl only"), with
// the human's explicit approval (2026-06-06): patch-to-patch signature changes are
// small and shouldn't require a new build. Etiquette still binds — a descriptive
// User-Agent, sequential throttled requests, never on the per-scan hot path (crawl
// runs only on first launch, when a newer patch is detected, or on a manual
// refresh). The bundled table remains the offline/first-run fallback.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, net } from 'electron';
import type { CrawlGet, CrawlProgress } from '../src/core/crawl';
import { crawlSignatureTable, detectPatch, WIKI_USER_AGENT } from '../src/core/crawl';
import { isVersionNewer } from '../src/core/semver';
import { loadSignatureTable } from '../src/core/table';
import type { SignatureTable } from '../src/core/types';
import { log } from './log';

const THROTTLE_MS = 150;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const tablesDir = (): string => path.join(app.getPath('userData'), 'tables');

/**
 * A throttled `net.fetch` (Chromium's stack → honors system proxy) with a
 * descriptive UA + light retry. No persistent cache: a crawl is infrequent and
 * cache keys would collide across patches, so each crawl fetches fresh.
 */
function makeGet(): CrawlGet {
  return async <T>(url: string, _cacheKey: string): Promise<T> => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await net.fetch(url, {
          headers: { 'User-Agent': WIKI_USER_AGENT, Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
        const json = (await res.json()) as T;
        await sleep(THROTTLE_MS);
        return json;
      } catch (err) {
        lastErr = err;
        if (attempt < 3) await sleep(400 * attempt);
      }
    }
    throw lastErr;
  };
}

/** Read every crawled table from userData, skipping any that don't parse. */
export function loadCrawledTables(): SignatureTable[] {
  const out: SignatureTable[] = [];
  let files: string[];
  try {
    files = readdirSync(tablesDir()).filter((f) => f.endsWith('.json'));
  } catch {
    return out; // dir doesn't exist yet (no crawl has run)
  }
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(path.join(tablesDir(), f), 'utf8'));
      out.push(loadSignatureTable(raw));
    } catch (e) {
      log.error(`skipping bad crawled table ${f}`, e);
    }
  }
  return out;
}

/**
 * Crawl the wiki and write <userData>/tables/<patch>.json. Rejects on an empty
 * crawl so a partial/failed run never overwrites a good table with nothing.
 */
export async function crawlAndSave(
  patch: string | undefined,
  onProgress?: (p: CrawlProgress) => void,
): Promise<SignatureTable> {
  const get = makeGet();
  const table = await crawlSignatureTable(get, { patch, method: 'Ship', onProgress });
  if (table.deposits.length === 0) throw new Error('crawl produced no deposits');
  mkdirSync(tablesDir(), { recursive: true });
  writeFileSync(path.join(tablesDir(), `${table.patch}.json`), JSON.stringify(table));
  log.info(`crawled ore data: patch=${table.patch} deposits=${table.deposits.length}`);
  return table;
}

/**
 * Check the live game patch and crawl only if it's newer than what the renderer
 * already has (`newestHave` = newest of bundled + crawled). Same patch → no
 * crawl (the user can still force one via refresh). Never blocks launch; every
 * failure is logged and swallowed so the app keeps running on its existing
 * table. Emits progress + an updated signal via `send`.
 */
export async function syncTables(
  newestHave: string | null,
  send: (channel: string, payload?: unknown) => void,
): Promise<void> {
  try {
    const get = makeGet();
    const livePatch = await detectPatch(get);
    if (livePatch === 'unknown') return; // API unreachable — keep what we have
    if (newestHave && !isVersionNewer(livePatch, newestHave)) {
      log.info(`ore data current (have ${newestHave}, live ${livePatch})`);
      return;
    }
    log.info(`ore data sync: crawling ${livePatch} (had ${newestHave ?? 'none'})`);
    await crawlAndSave(livePatch, (p) => send('sco:crawl-progress', p));
    send('sco:crawl-progress', { phase: 'done', done: 1, total: 1 });
    send('sco:tables-updated');
  } catch (e) {
    log.error('ore-data sync failed', e);
    send('sco:crawl-progress', { phase: 'error', done: 0, total: 0 });
  }
}

// Build-time crawl of the Star Citizen Wiki API → a compact local signature
// table the app ships as a fallback. The crawl logic lives in src/core/crawl.ts
// (shared with the runtime crawl in electron/tables.ts); this script is just the
// CLI wrapper: a disk-cached + throttled `get`, arg parsing, file output, and a
// sanity log. NEVER run on the per-scan hot path.
//
// Usage:
//   npm run crawl                       # ship-mineable only (v1), auto-detect patch
//   npm run crawl -- --patch=4.2        # tag the output with a patch
//   npm run crawl -- --all-methods      # keep every mining method (Phase 5)
//   npm run crawl -- --refresh          # ignore the cache and re-fetch
//   npm run crawl -- --out=src/data/signatures.json --delay=150

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CrawlGet } from '../src/core/crawl';
import { crawlSignatureTable, detectPatch, WIKI_USER_AGENT } from '../src/core/crawl';

// npm scripts run with the package root as cwd.
const repoRoot = process.cwd();
const CACHE_DIR = path.join(repoRoot, '.cache', 'wiki');

const argv = process.argv.slice(2);
const hasFlag = (name: string): boolean => argv.includes(`--${name}`);
const getOpt = (name: string, fallback: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PATCH_ARG = getOpt('patch', ''); // empty → auto-detect from the API
const OUT_ARG = getOpt('out', ''); // empty → src/data/tables/<patch>.json
const METHOD = getOpt('method', 'Ship');
const ALL_METHODS = hasFlag('all-methods');
const REFRESH = hasFlag('refresh');
const DELAY_MS = Number(getOpt('delay', '150'));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson<T>(url: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': WIKI_USER_AGENT, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await sleep(400 * attempt);
    }
  }
  throw lastErr;
}

/** Fetch via the on-disk cache (unless --refresh). Throttles only on a miss. */
const cachedGet: CrawlGet = async <T>(url: string, cacheKey: string): Promise<T> => {
  const file = path.join(CACHE_DIR, cacheKey);
  if (!REFRESH) {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch {
      // cache miss — fall through to network
    }
  }
  const json = await fetchJson<T>(url);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(json));
  await sleep(DELAY_MS);
  return json;
};

async function main(): Promise<void> {
  console.log(`Crawling the wiki (cache: ${REFRESH ? 'refresh' : 'on'})`);
  const patch = PATCH_ARG || (await detectPatch(cachedGet));
  const OUT = path.resolve(
    repoRoot,
    OUT_ARG || path.join('src', 'data', 'tables', `${patch}.json`),
  );
  console.log(`patch=${patch}`);

  const table = await crawlSignatureTable(cachedGet, {
    patch,
    method: METHOD,
    allMethods: ALL_METHODS,
    onProgress: (p) => {
      if (p.phase === 'detail' && p.done % 10 === 0) console.log(`  detail ${p.done}/${p.total}`);
    },
  });

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(table, null, 2)}\n`);

  // ----- sanity log -----
  const { deposits } = table;
  console.log(`deposits=${deposits.length}`);
  console.log(`wrote ${path.relative(repoRoot, OUT)} (patch=${patch})`);

  const distinctOres = new Set(deposits.map((d) => d.name)).size;
  console.log(`distinct ores=${distinctOres}`);

  const iron = deposits.find((d) => d.name === 'Iron');
  if (iron) {
    const ok = iron.signature === 4270;
    console.log(
      `SANITY Iron: signature=${iron.signature} ${ok ? 'OK ✓ (4270)' : 'UNEXPECTED ✗ (expected 4270)'} ` +
        `cluster=${iron.clustering.minSize}-${iron.clustering.maxSize} locations=${iron.locations.length}`,
    );
  } else {
    console.log('SANITY Iron: NOT FOUND ✗');
  }

  if (deposits.length === 0) {
    console.error('No deposits produced — aborting with a non-zero exit.');
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error('Crawl failed:', err);
  process.exitCode = 1;
});

// Build-time crawl of the Star Citizen Wiki API → a compact local signature
// table the renderer can load. NEVER run on the per-scan hot path.
//
//   List:   GET /api/commodities?page[number]=N   (paginated, 30/page)
//   Detail: GET /api/commodities/{uuid}
//
// The scanner value lives nested at `locations[].resources[].signature`
// (Iron = 4270), NOT at top-level `data.signature` (Iron = 4700).
//
// Etiquette: a descriptive User-Agent, sequential requests with a throttle,
// and an on-disk cache so re-runs don't re-hit the API. Re-crawl per patch.
//
// Usage:
//   npm run crawl                       # ship-mineable only (v1), patch "unknown"
//   npm run crawl -- --patch=4.2        # tag the output with a patch
//   npm run crawl -- --all-methods      # keep every mining method (Phase 5)
//   npm run crawl -- --refresh          # ignore the cache and re-fetch
//   npm run crawl -- --out=src/data/signatures.json --delay=150

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  ClusterParam,
  Clustering,
  Deposit,
  DepositLocation,
  SignatureTable,
} from '../src/core/types';

// ---------------------------------------------------------------------------
// Shape of the bits of the wiki response we consume (loose by design).
// ---------------------------------------------------------------------------
interface WikiClusterParam {
  min_size?: number;
  max_size?: number;
  relative_probability?: number;
}
interface WikiClustering {
  min_size?: number;
  max_size?: number;
  params?: WikiClusterParam[] | null;
}
interface WikiResource {
  key?: string;
  label?: string;
  signature?: number | null;
  clustering?: WikiClustering | null;
}
interface WikiLocation {
  name?: string;
  display_name?: string;
  system?: string;
  uuid?: string;
  group_probability?: number | null;
  resources?: WikiResource[] | null;
}
interface WikiCommodity {
  uuid: string;
  name: string;
  is_mineable?: boolean;
  has_ship_mineables?: boolean;
  signature?: number | null;
  methods?: string[] | null;
  locations?: WikiLocation[] | null;
}
interface WikiListResponse {
  data: WikiCommodity[];
  meta?: { last_page?: number };
}
interface WikiDetailResponse {
  data: WikiCommodity;
}

// ---------------------------------------------------------------------------
// Config / CLI args
// ---------------------------------------------------------------------------
const API_BASE = 'https://api.star-citizen.wiki/api';
const USER_AGENT =
  'sc-ore-overlay/0.1 (build-time signature crawler; +https://api.star-citizen.wiki)';

// npm scripts run with the package root as cwd.
const repoRoot = process.cwd();
const CACHE_DIR = path.join(repoRoot, '.cache', 'wiki');

const argv = process.argv.slice(2);
const hasFlag = (name: string): boolean => argv.includes(`--${name}`);
const getOpt = (name: string, fallback: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PATCH = getOpt('patch', 'unknown');
const OUT = path.resolve(repoRoot, getOpt('out', 'src/data/signatures.json'));
const METHOD = getOpt('method', 'Ship');
const ALL_METHODS = hasFlag('all-methods');
const REFRESH = hasFlag('refresh');
const DELAY_MS = Number(getOpt('delay', '150'));

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Fetch + cache helpers
// ---------------------------------------------------------------------------
async function fetchJson<T>(url: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
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
async function cachedGet<T>(url: string, cacheKey: string): Promise<T> {
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
}

// ---------------------------------------------------------------------------
// Crawl
// ---------------------------------------------------------------------------
async function listAllCommodities(): Promise<WikiCommodity[]> {
  const first = await cachedGet<WikiListResponse>(
    `${API_BASE}/commodities?page[number]=1`,
    'list-p1.json',
  );
  const lastPage = first.meta?.last_page ?? 1;
  const items = [...first.data];
  for (let page = 2; page <= lastPage; page += 1) {
    const resp = await cachedGet<WikiListResponse>(
      `${API_BASE}/commodities?page[number]=${page}`,
      `list-p${page}.json`,
    );
    items.push(...resp.data);
  }
  return items;
}

/** Working row: like a Deposit but with Set/Map for cheap de-duplicated merge. */
interface RowAccumulator {
  name: string;
  signature: number;
  methods: Set<string>;
  clustering: Clustering;
  locations: Map<string, DepositLocation>;
  commoditySignature?: number;
  commodityName?: string;
  resourceKey?: string;
}

function toClustering(cl: WikiClustering): Clustering | null {
  if (typeof cl.min_size !== 'number' || typeof cl.max_size !== 'number') return null;
  const params: ClusterParam[] = (cl.params ?? [])
    .filter(
      (p): p is Required<WikiClusterParam> =>
        typeof p.min_size === 'number' &&
        typeof p.max_size === 'number' &&
        typeof p.relative_probability === 'number',
    )
    .map((p) => ({
      minSize: p.min_size,
      maxSize: p.max_size,
      relativeProbability: p.relative_probability,
    }));
  return { minSize: cl.min_size, maxSize: cl.max_size, params };
}

async function main(): Promise<void> {
  console.log(`Crawling ${API_BASE} (cache: ${REFRESH ? 'refresh' : 'on'})`);
  const all = await listAllCommodities();
  const mineable = all.filter((c) => c.is_mineable === true);

  // For v1 we only need the requested method's commodities; record the full
  // mineable count so we can confirm we enumerated everything.
  const targets = ALL_METHODS
    ? mineable
    : mineable.filter(
        (c) => (c.methods ?? []).includes(METHOD) || c.has_ship_mineables === true,
      );

  console.log(
    `commodities=${all.length} mineable=${mineable.length} ` +
      `targets(${ALL_METHODS ? 'all-methods' : METHOD})=${targets.length}`,
  );

  const rows = new Map<string, RowAccumulator>();
  let skippedResources = 0;

  for (const item of targets) {
    const detail = await cachedGet<WikiDetailResponse>(
      `${API_BASE}/commodities/${item.uuid}`,
      `detail-${item.uuid}.json`,
    );
    const data = detail.data;
    const methods = data.methods ?? [];

    for (const loc of data.locations ?? []) {
      for (const res of loc.resources ?? []) {
        const sig = res.signature;
        if (typeof sig !== 'number' || sig <= 0) {
          skippedResources += 1;
          continue;
        }
        const clustering = res.clustering ? toClustering(res.clustering) : null;
        if (!clustering) {
          skippedResources += 1;
          continue;
        }

        const label = res.label ?? data.name;
        // One row per distinct material + signature + cluster range.
        const key = `${label}__${sig}__${clustering.minSize}-${clustering.maxSize}`;

        let row = rows.get(key);
        if (!row) {
          row = {
            name: label,
            signature: sig,
            methods: new Set<string>(),
            clustering,
            locations: new Map<string, DepositLocation>(),
            commoditySignature:
              typeof data.signature === 'number' ? data.signature : undefined,
            commodityName: data.name,
            resourceKey: res.key,
          };
          rows.set(key, row);
        }

        for (const m of methods) row.methods.add(m);

        const locName = loc.display_name ?? loc.name ?? 'Unknown';
        const locKey = loc.uuid ?? `${loc.system ?? ''}:${locName}`;
        if (!row.locations.has(locKey)) {
          row.locations.set(locKey, {
            system: loc.system ?? 'Unknown System',
            name: locName,
            uuid: loc.uuid,
            probability:
              typeof loc.group_probability === 'number' ? loc.group_probability : 1,
          });
        }
      }
    }
  }

  let deposits: Deposit[] = [...rows.values()].map((r) => ({
    name: r.name,
    signature: r.signature,
    methods: [...r.methods],
    clustering: r.clustering,
    locations: [...r.locations.values()],
    commoditySignature: r.commoditySignature,
    commodityName: r.commodityName,
    resourceKey: r.resourceKey,
  }));

  if (!ALL_METHODS) deposits = deposits.filter((d) => d.methods.includes(METHOD));
  deposits.sort((a, b) => a.name.localeCompare(b.name) || a.signature - b.signature);

  const table: SignatureTable = {
    patch: PATCH,
    generatedAt: new Date().toISOString(),
    source: API_BASE,
    methodsIncluded: ALL_METHODS ? ['*'] : [METHOD],
    deposits,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(table, null, 2)}\n`);

  // ----- sanity log -----
  console.log(
    `rows=${rows.size} deposits=${deposits.length} skippedResources=${skippedResources}`,
  );
  console.log(`wrote ${path.relative(repoRoot, OUT)} (patch=${PATCH})`);

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

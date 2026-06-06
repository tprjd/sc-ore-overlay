// Crawl of the Star Citizen Wiki API → a compact SignatureTable. Framework-free:
// the caller injects a `get(url, cacheKey)` that does the actual fetch (+ its own
// throttle/cache/User-Agent), so this same logic runs both build-time (Node
// `fetch` + disk cache, scripts/crawl-wiki.ts) and at runtime in the Electron
// main process (`net.fetch`, electron/tables.ts). NEVER run on the per-scan hot
// path — list + one detail request per mineable commodity is dozens of calls.
//
//   List:   GET /api/commodities?page[number]=N   (paginated, 30/page)
//   Detail: GET /api/commodities/{uuid}
//
// The scanner value lives nested at `locations[].resources[].signature`
// (Iron = 4270), NOT at top-level `data.signature` (Iron = 4700).

import type {
  Clustering,
  ClusterParam,
  Deposit,
  DepositLocation,
  QualityMaterial,
  SignatureTable,
} from './types';

export const WIKI_API_BASE = 'https://api.star-citizen.wiki/api';
export const WIKI_USER_AGENT = 'sc-ore-overlay (signature crawler; +https://api.star-citizen.wiki)';

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
  probability?: number | null;
  params?: WikiClusterParam[] | null;
}
interface WikiMaterial {
  name?: string;
  min_percentage?: number | null;
  max_percentage?: number | null;
  quality_min?: number | null;
  quality_max?: number | null;
  quality_mean?: number | null;
  quality_stddev?: number | null;
  quality_quantized_values?: number[] | null;
  instability?: number | null;
  resistance?: number | null;
}
interface WikiResource {
  key?: string;
  label?: string;
  signature?: number | null;
  clustering?: WikiClustering | null;
  materials?: WikiMaterial[] | null;
}
interface WikiLocation {
  name?: string;
  display_name?: string;
  system?: string;
  type?: string;
  uuid?: string;
  group_probability?: number | null;
  relative_probability?: number | null;
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
interface WikiGameVersion {
  code: string;
  channel?: string;
  is_default?: boolean;
}

/** Injected fetch: resolve `url` to JSON. `cacheKey` lets a disk cache key it. */
export type CrawlGet = <T>(url: string, cacheKey: string) => Promise<T>;

/** Progress for the UI: which phase, and how far through it. */
export interface CrawlProgress {
  phase: 'versions' | 'list' | 'detail' | 'done' | 'error';
  done: number;
  total: number;
}

export interface CrawlOptions {
  /** Explicit patch label; omit to auto-detect from the API. */
  patch?: string;
  /** Mining method to keep (v1: "Ship"). */
  method?: string;
  /** Keep every method instead of filtering to `method` (Phase 5). */
  allMethods?: boolean;
  /** Progress callback (best-effort). */
  onProgress?: (p: CrawlProgress) => void;
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
  return {
    minSize: cl.min_size,
    maxSize: cl.max_size,
    probability: typeof cl.probability === 'number' ? cl.probability : undefined,
    params,
  };
}

function toMaterials(materials: WikiMaterial[] | null | undefined): QualityMaterial[] {
  return (materials ?? [])
    .filter((m): m is WikiMaterial & { name: string } => typeof m.name === 'string')
    .map((m) => ({
      name: m.name,
      minPercent: typeof m.min_percentage === 'number' ? m.min_percentage : 0,
      maxPercent: typeof m.max_percentage === 'number' ? m.max_percentage : 0,
      qualityMin: typeof m.quality_min === 'number' ? m.quality_min : 0,
      qualityMax: typeof m.quality_max === 'number' ? m.quality_max : 0,
      mean: typeof m.quality_mean === 'number' ? m.quality_mean : 0,
      stddev: typeof m.quality_stddev === 'number' ? m.quality_stddev : 0,
      quantized: Array.isArray(m.quality_quantized_values) ? m.quality_quantized_values : [],
      instability: typeof m.instability === 'number' ? m.instability : 0,
      resistance: typeof m.resistance === 'number' ? m.resistance : 0,
    }));
}

/** Detect the current game patch label (e.g. "4.8.0") from the wiki API. */
export async function detectPatch(get: CrawlGet): Promise<string> {
  try {
    const resp = await get<{ data: WikiGameVersion[] }>(
      `${WIKI_API_BASE}/game-versions`,
      'game-versions.json',
    );
    const versions = resp.data ?? [];
    const current = versions.find((v) => v.is_default) ?? versions[0];
    if (current?.code) return current.code.split('-')[0]; // "4.8.0-LIVE.x" → "4.8.0"
  } catch {
    // fall through to "unknown"
  }
  return 'unknown';
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
  materials: QualityMaterial[];
}

async function listAllCommodities(
  get: CrawlGet,
  onProgress?: (p: CrawlProgress) => void,
): Promise<WikiCommodity[]> {
  const first = await get<WikiListResponse>(
    `${WIKI_API_BASE}/commodities?page[number]=1`,
    'list-p1.json',
  );
  const lastPage = first.meta?.last_page ?? 1;
  const items = [...first.data];
  onProgress?.({ phase: 'list', done: 1, total: lastPage });
  for (let page = 2; page <= lastPage; page += 1) {
    const resp = await get<WikiListResponse>(
      `${WIKI_API_BASE}/commodities?page[number]=${page}`,
      `list-p${page}.json`,
    );
    items.push(...resp.data);
    onProgress?.({ phase: 'list', done: page, total: lastPage });
  }
  return items;
}

/**
 * Crawl the wiki and derive a `SignatureTable`. The caller's `get` owns the
 * actual transport (throttle/cache/UA). Resolves even on a partial/empty crawl;
 * the caller should reject an empty `deposits` array rather than overwrite a
 * good table with nothing.
 */
export async function crawlSignatureTable(
  get: CrawlGet,
  opts: CrawlOptions = {},
): Promise<SignatureTable> {
  const { method = 'Ship', allMethods = false, onProgress } = opts;
  onProgress?.({ phase: 'versions', done: 0, total: 1 });
  const patch = opts.patch ?? (await detectPatch(get));

  const all = await listAllCommodities(get, onProgress);
  const mineable = all.filter((c) => c.is_mineable === true);
  const targets = allMethods
    ? mineable
    : mineable.filter((c) => (c.methods ?? []).includes(method) || c.has_ship_mineables === true);

  const rows = new Map<string, RowAccumulator>();
  let done = 0;
  for (const item of targets) {
    const detail = await get<WikiDetailResponse>(
      `${WIKI_API_BASE}/commodities/${item.uuid}`,
      `detail-${item.uuid}.json`,
    );
    done += 1;
    onProgress?.({ phase: 'detail', done, total: targets.length });
    const data = detail.data;
    const methods = data.methods ?? [];

    for (const loc of data.locations ?? []) {
      for (const res of loc.resources ?? []) {
        const sig = res.signature;
        if (typeof sig !== 'number' || sig <= 0) continue;
        const clustering = res.clustering ? toClustering(res.clustering) : null;
        if (!clustering) continue;

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
            commoditySignature: typeof data.signature === 'number' ? data.signature : undefined,
            commodityName: data.name,
            resourceKey: res.key,
            materials: toMaterials(res.materials),
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
            type: loc.type,
            probability: typeof loc.group_probability === 'number' ? loc.group_probability : 1,
            occurrence:
              typeof loc.relative_probability === 'number' ? loc.relative_probability : undefined,
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
    materials: r.materials,
  }));

  if (!allMethods) deposits = deposits.filter((d) => d.methods.includes(method));
  deposits.sort((a, b) => a.name.localeCompare(b.name) || a.signature - b.signature);

  return {
    patch,
    generatedAt: new Date().toISOString(),
    source: WIKI_API_BASE,
    methodsIncluded: allMethods ? ['*'] : [method],
    deposits,
  };
}

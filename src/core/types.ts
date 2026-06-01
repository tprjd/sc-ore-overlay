// Pure, framework-free data types shared across the app. No Electron / DOM here.
//
// The scanner HUD shows a *total* Radar Signature (RS) that equals one deposit's
// per-deposit signature times the number of rocks (nodes) in the cluster:
//
//     total_RS = deposit.signature × node_count
//
// Identification is therefore constrained division (see `matchOre`), not text
// recognition of an ore name.

/** One per-size clustering bucket (from the wiki `resource.clustering.params`). */
export interface ClusterParam {
  /** Smallest node count this bucket covers (inclusive). */
  minSize: number;
  /** Largest node count this bucket covers (inclusive). */
  maxSize: number;
  /** Relative likelihood weight for this bucket (not necessarily normalized). */
  relativeProbability: number;
}

/** Valid node-count range plus per-size weights for a single deposit. */
export interface Clustering {
  /** Smallest valid cluster size (inclusive). */
  minSize: number;
  /** Largest valid cluster size (inclusive). */
  maxSize: number;
  /** Overall probability the deposit clusters (wiki clustering.probability, 0..1). */
  probability?: number;
  /** Per-size probability buckets. May be empty (then treated as uniform). */
  params: ClusterParam[];
}

/** One material in a deposit's composition, with its quality distribution. */
export interface QualityMaterial {
  /** Material name, e.g. "Aluminum (Ore)". */
  name: string;
  /** Composition percentage range (min..max). */
  minPercent: number;
  maxPercent: number;
  /** Quality value range, e.g. 245..490. */
  qualityMin: number;
  qualityMax: number;
  /** Mean quality. */
  mean: number;
  /** Quality standard deviation. */
  stddev: number;
  /** Quantized quality values the scanner can report (the "Received" column). */
  quantized: number[];
  instability: number;
  resistance: number;
}

/** A place a deposit spawns, merged across the build-time crawl. */
export interface DepositLocation {
  /** System name, e.g. "Stanton System". */
  system: string;
  /** Human-facing location name, e.g. "ARC L3". */
  name: string;
  /** Wiki location uuid, when available (used for de-duplication). */
  uuid?: string;
  /** Spawn weight for this location (wiki `group_probability`, 0..1). */
  probability: number;
  /** Location type, e.g. "Asteroid". */
  type?: string;
  /** Occurrence weight at this location (wiki `relative_probability`, 0..1). */
  occurrence?: number;
}

/**
 * One row of the signature table: a distinct combination of
 * `material + signature + cluster range`, with all locations merged in.
 */
export interface Deposit {
  /** Ore name the scanner cares about, e.g. "Iron". */
  name: string;
  /** Per-deposit signature — the value the scanner shows, e.g. 4270. */
  signature: number;
  /** Mining methods this deposit supports, e.g. ["Ship"]. */
  methods: string[];
  /** Valid cluster sizes and their per-size weights. */
  clustering: Clustering;
  /** Where this deposit spawns. */
  locations: DepositLocation[];
  /**
   * Commodity-level signature (wiki `data.signature`, e.g. Iron = 4700).
   * NOT what the scanner shows — kept only for an optional calibration check.
   */
  commoditySignature?: number;
  /** Source commodity name, e.g. "Iron (Ore)". */
  commodityName?: string;
  /** Source resource key, e.g. "MineableRock_AsteroidCommon_Iron". */
  resourceKey?: string;
  /** Material composition + per-material quality (for the detail view). */
  materials?: QualityMaterial[];
}

/** The compact table the crawl writes and the renderer loads. */
export interface SignatureTable {
  /** Game patch this data was crawled for, e.g. "4.2" or "unknown". */
  patch: string;
  /** ISO timestamp the table was generated. */
  generatedAt: string;
  /** Where the data came from (API base URL). */
  source: string;
  /** Which mining methods were kept in this table, e.g. ["Ship"] or ["*"]. */
  methodsIncluded: string[];
  /** All deposit rows. */
  deposits: Deposit[];
}

/** Options controlling how the matcher accepts a candidate. */
export interface MatchOptions {
  /** Mining method to match, e.g. "Ship" for v1. */
  method: string;
  /**
   * Maximum relative error allowed between the reading and `n × signature`.
   * Defaults to 0.005 (0.5%). Keeps OCR jitter in while rejecting non-divisors.
   */
  relTol?: number;
}

/** Context that narrows and re-weights matches. */
export interface MatchContext {
  /**
   * Location name to constrain to. When set, deposits that do not spawn there
   * are skipped, and matches are weighted by that location's spawn probability.
   * Leave unset (or null) for "Anywhere".
   */
  location?: string | null;
}

/** A ranked candidate ore for a given reading. */
export interface OreCandidate {
  /** Ore name, e.g. "Iron". */
  name: string;
  /** Node count: `round(reading / signature)`. */
  nodes: number;
  /** Ranking score in (0, 1]; higher is more likely. */
  score: number;
  /** The deposit signature that produced this candidate. */
  signature: number;
  /**
   * Non-ore noise signature subtracted from the reading before matching, e.g.
   * a 10,000-unit wreck signal sitting on top of an iron deposit. Null/undefined
   * means the reading matched directly. Surfaces in the UI as a "+wreck" hint.
   */
  noise?: number | null;
}

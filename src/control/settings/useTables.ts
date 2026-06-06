// Signature-table source for the control window. Seeds synchronously from the
// bundled tables (so the app works offline / on first run before any crawl),
// then merges the runtime-crawled tables from the main process — preferring a
// crawled table per patch — and re-merges whenever a crawl finishes. Also tracks
// crawl progress and exposes a manual refresh. See electron/tables.ts.

import { useCallback, useEffect, useState } from 'react';
import type { SignatureTable } from '../../core';
import { loadSignatureTable } from '../../core';
import { isVersionNewer } from '../../core/semver';
import type { CrawlProgress } from '../../shared/bridge';

// Bundled fallback tables, inlined at build time.
const tableModules = import.meta.glob('../../data/tables/*.json', {
  eager: true,
  import: 'default',
});
function bundledTables(): Record<string, SignatureTable> {
  const out: Record<string, SignatureTable> = {};
  for (const mod of Object.values(tableModules)) {
    const t = loadSignatureTable(mod);
    out[t.patch] = t;
  }
  return out;
}
const BUNDLED = bundledTables();

/** Newest patch label among the given list, or null if empty. */
function newestPatch(patches: string[]): string | null {
  return patches.reduce<string | null>(
    (best, p) => (best && !isVersionNewer(p, best) ? best : p),
    null,
  );
}

export interface UseTables {
  /** patch → table (bundled, overlaid with any crawled tables). */
  tables: Record<string, SignatureTable>;
  /** A crawl (startup or manual) is in flight. */
  refreshing: boolean;
  /** Latest crawl progress, or null when idle. */
  progress: CrawlProgress | null;
  /** Force a re-crawl of the current game patch. */
  refresh: () => void;
}

export function useTables(): UseTables {
  const [tables, setTables] = useState<Record<string, SignatureTable>>(BUNDLED);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);

  const mergeCrawled = useCallback((crawled: SignatureTable[] | null | undefined) => {
    if (!crawled?.length) return;
    setTables((prev) => {
      const next = { ...prev };
      for (const raw of crawled) {
        try {
          const t = loadSignatureTable(raw);
          next[t.patch] = t; // crawled wins over a bundled table of the same patch
        } catch {
          // skip an unparseable crawled table; keep the fallback
        }
      }
      return next;
    });
  }, []);

  const loadCrawled = useCallback(() => {
    window.sco
      ?.getCrawledTables?.()
      .then(mergeCrawled)
      .catch(() => {});
  }, [mergeCrawled]);

  useEffect(() => {
    // Initial load, then ask main to crawl only if the live game patch is newer
    // than the newest table we already have (bundled + crawled).
    window.sco
      ?.getCrawledTables?.()
      .then((crawled) => {
        mergeCrawled(crawled);
        const patches = [
          ...Object.keys(BUNDLED),
          ...(crawled ?? []).map((t) => t.patch).filter(Boolean),
        ];
        window.sco?.syncTables?.(newestPatch(patches));
      })
      .catch(() => {});

    const offUpdated = window.sco?.onTablesUpdated?.(() => {
      setRefreshing(false);
      setProgress(null);
      loadCrawled();
    });
    const offProgress = window.sco?.onCrawlProgress?.((p) => {
      if (p.phase === 'done' || p.phase === 'error') {
        setRefreshing(false);
        setProgress(null);
      } else {
        setRefreshing(true);
        setProgress(p);
      }
    });
    return () => {
      offUpdated?.();
      offProgress?.();
    };
  }, [loadCrawled, mergeCrawled]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    window.sco
      ?.refreshTables?.()
      .then((t) => mergeCrawled(t ? [t] : null))
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [mergeCrawled]);

  return { tables, refreshing, progress, refresh };
}

// A collapsible, searchable, sortable column of the actual scanned results —
// the logged (and simulated peer) entries, not a reference of every possible
// ore. Sits between the preview and the settings panel. Read-only except for a
// per-row delete.

import { ChevronLeft, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ScanResult, SurveyEntry } from '../../core';
import { cn } from '../ui/cn';

type SortKey = 'ore' | 'quality' | 'scu' | 'system' | 'scout' | 'ts';

interface RowData {
  id: string;
  ore: string;
  nodes?: number;
  quality: number | null;
  scu: number | null;
  system: string;
  scout: string;
  ts: number;
}

/** The dominant (highest-percent, non-inert) composition row of a scan. */
function dominantRow(scan: ScanResult): ScanResult['composition'][number] | undefined {
  return scan.composition
    .filter((c) => !/inert/i.test(c.material))
    .reduce<ScanResult['composition'][number] | undefined>(
      (best, c) => (best == null || c.percent > best.percent ? c : best),
      undefined,
    );
}

function toRow(e: SurveyEntry): RowData {
  const main = e.scan ? dominantRow(e.scan) : undefined;
  return {
    id: e.id,
    ore: e.ore ?? '—',
    nodes: e.nodes,
    quality: main?.quality ?? null,
    scu: e.scan?.scu ?? null,
    system: e.system,
    scout: e.scout,
    ts: e.ts,
  };
}

const COLS: Array<{ key: SortKey; label: string; w?: number; align?: 'right' }> = [
  { key: 'ore', label: 'Ore' },
  { key: 'quality', label: 'Qual', w: 44, align: 'right' },
  { key: 'scu', label: 'SCU', w: 50, align: 'right' },
  { key: 'system', label: 'Sys', w: 60 },
  { key: 'scout', label: 'Scout', w: 56 },
];

const ago = (ts: number): string => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
};

export function ScanResults({
  entries,
  onRemove,
}: {
  entries: SurveyEntry[];
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('ts');
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => entries.map(toRow), [entries]);
  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? rows.filter(
          (r) =>
            r.ore.toLowerCase().includes(needle) ||
            r.scout.toLowerCase().includes(needle) ||
            r.system.toLowerCase().includes(needle),
        )
      : rows;
    const dir = desc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'number' || typeof bv === 'number') {
        return (
          ((typeof av === 'number' ? av : -Infinity) - (typeof bv === 'number' ? bv : -Infinity)) *
          dir
        );
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, q, sortKey, desc]);

  const toggleSort = (key: SortKey): void => {
    if (key === sortKey) setDesc((d) => !d);
    else {
      setSortKey(key);
      setDesc(key !== 'ore' && key !== 'system' && key !== 'scout');
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="flex w-[30px] shrink-0 cursor-pointer items-center justify-center border-l border-border bg-surface-alt p-0 text-muted"
        onClick={() => setOpen(true)}
        title="Scan results"
      >
        <span className="rotate-180 text-[11px] uppercase tracking-widest [writing-mode:vertical-rl]">
          SCAN RESULTS ({entries.length}) ▸
        </span>
      </button>
    );
  }

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-border bg-surface-alt min-h-0">
      <div className="flex items-center gap-2 px-3 pb-1.5 pt-2.5">
        <span className="text-xs uppercase tracking-wide text-fg/70">Scan results</span>
        <span className="tnum text-[11px] text-fg/45">{view.length}</span>
        <button
          className="ml-auto rounded-md border border-border-strong px-2 py-0.5 text-muted transition-colors hover:text-fg"
          onClick={() => setOpen(false)}
          title="Collapse"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        className="mx-3 mb-2 rounded-md border border-border-strong bg-bg px-2 py-1.5 text-[13px] text-fg outline-none focus:border-accent/60"
        placeholder="search ore / scout / system…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="flex gap-1.5 border-b border-border px-3 pb-1">
        {COLS.map((c) => (
          <button
            key={c.key}
            className={cn(
              'tnum cursor-pointer border-none bg-none py-0.5 text-[10px] uppercase tracking-wide',
              c.align === 'right' ? 'text-right' : 'text-left',
              c.key === sortKey ? 'text-fg' : 'text-muted',
            )}
            style={c.w ? { width: c.w, flex: '0 0 auto' } : { flex: 1, minWidth: 0 }}
            onClick={() => toggleSort(c.key)}
          >
            {c.label}
            {c.key === sortKey ? (desc ? ' ▼' : ' ▲') : ''}
          </button>
        ))}
        <span className="w-4 shrink-0" />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3 pt-1">
        {view.map((r) => (
          <div
            key={r.id}
            className="flex items-baseline gap-1.5 border-b border-surface py-1 text-xs"
          >
            <span className="min-w-0 flex-1 truncate font-semibold" title={`${ago(r.ts)} ago`}>
              {r.ore}
              {r.nodes ? <span className="font-normal text-accent"> ×{r.nodes}</span> : null}
            </span>
            <span className="tnum shrink-0 text-right text-fg/85" style={{ width: 44 }}>
              {r.quality ?? '—'}
            </span>
            <span className="tnum shrink-0 text-right text-fg/85" style={{ width: 50 }}>
              {r.scu != null ? r.scu.toFixed(1) : '—'}
            </span>
            <span className="shrink-0 truncate text-left text-fg/70" style={{ width: 60 }}>
              {r.system}
            </span>
            <span className="shrink-0 truncate text-left text-fg/70" style={{ width: 56 }}>
              {r.scout}
            </span>
            <button
              className="grid w-4 shrink-0 place-items-center text-[#5b6571] transition-colors hover:text-fg"
              onClick={() => onRemove(r.id)}
              title="Remove"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {view.length === 0 && (
          <div className="p-4 text-center text-xs text-fg/40">no scans yet</div>
        )}
      </div>
    </div>
  );
}

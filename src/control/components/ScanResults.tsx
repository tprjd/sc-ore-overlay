// A collapsible, searchable, sortable column of the actual scanned results —
// the logged (and simulated peer) entries, not a reference of every possible
// ore. Sits between the preview and the settings panel. Read-only except for a
// per-row delete.

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

import type { ScanResult, SurveyEntry } from '../../core';

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
        return ((typeof av === 'number' ? av : -Infinity) - (typeof bv === 'number' ? bv : -Infinity)) * dir;
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
      <button style={S.closed} onClick={() => setOpen(true)} title="Scan results">
        <span style={S.closedLabel}>SCAN RESULTS ({entries.length}) ▸</span>
      </button>
    );
  }

  return (
    <div style={S.col}>
      <div style={S.head}>
        <span style={S.title}>Scan results</span>
        <span style={S.count}>{view.length}</span>
        <button style={S.collapse} onClick={() => setOpen(false)} title="Collapse">
          ◂
        </button>
      </div>
      <input style={S.search} placeholder="search ore / scout / system…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={S.headerRow}>
        {COLS.map((c) => (
          <button
            key={c.key}
            style={{
              ...S.th,
              ...(c.w ? { width: c.w, flex: '0 0 auto' } : { flex: 1, minWidth: 0 }),
              textAlign: c.align ?? 'left',
              color: c.key === sortKey ? '#e6e6e6' : '#9fb3c8',
            }}
            onClick={() => toggleSort(c.key)}
          >
            {c.label}
            {c.key === sortKey ? (desc ? ' ▼' : ' ▲') : ''}
          </button>
        ))}
        <span style={S.delHead} />
      </div>
      <div style={S.list}>
        {view.map((r) => (
          <div key={r.id} style={S.row}>
            <span style={S.ore} title={`${ago(r.ts)} ago`}>
              {r.ore}
              {r.nodes ? <span style={S.nodes}> ×{r.nodes}</span> : null}
            </span>
            <span style={{ ...S.cell, width: 44 }}>{r.quality ?? '—'}</span>
            <span style={{ ...S.cell, width: 50 }}>{r.scu != null ? r.scu.toFixed(1) : '—'}</span>
            <span style={{ ...S.cellL, width: 60 }}>{r.system}</span>
            <span style={{ ...S.cellL, width: 56 }}>{r.scout}</span>
            <button style={S.del} onClick={() => onRemove(r.id)} title="Remove">
              ✕
            </button>
          </div>
        ))}
        {view.length === 0 && <div style={S.empty}>no scans yet</div>}
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  closed: { width: 30, flex: '0 0 auto', borderLeft: '1px solid #2c323d', background: '#16181d', color: '#9fb3c8', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  closedLabel: { writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  col: { width: 320, flex: '0 0 auto', display: 'flex', flexDirection: 'column', borderLeft: '1px solid #2c323d', background: '#16181d', minHeight: 0 },
  head: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 6px' },
  title: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.7 },
  count: { fontSize: 11, opacity: 0.45, fontVariantNumeric: 'tabular-nums' },
  collapse: { marginLeft: 'auto', background: 'none', border: '1px solid #3a4150', borderRadius: 6, color: '#9fb3c8', cursor: 'pointer', padding: '2px 8px', fontSize: 12 },
  search: { margin: '0 12px 8px', background: '#0d0f12', color: '#e6e6e6', border: '1px solid #3a4150', borderRadius: 6, padding: '6px 8px', fontSize: 13 },
  headerRow: { display: 'flex', gap: 6, padding: '0 12px 4px', borderBottom: '1px solid #2c323d' },
  th: { background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, fontVariantNumeric: 'tabular-nums' },
  delHead: { width: 16, flex: '0 0 auto' },
  list: { flex: 1, overflowY: 'auto', padding: '4px 12px 12px' },
  row: { display: 'flex', gap: 6, alignItems: 'baseline', padding: '4px 0', borderBottom: '1px solid #1d2128', fontSize: 12 },
  ore: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 },
  nodes: { color: '#4fd1ff', fontWeight: 400 },
  cell: { flex: '0 0 auto', textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.85 },
  cellL: { flex: '0 0 auto', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.7 },
  del: { width: 16, flex: '0 0 auto', background: 'none', border: 'none', color: '#5b6571', cursor: 'pointer', fontSize: 11, padding: 0 },
  empty: { padding: 16, textAlign: 'center', opacity: 0.4, fontSize: 12 },
};

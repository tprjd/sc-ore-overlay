// A collapsible reference column listing every ore in the active signature
// table with useful info — signature (RS), valid cluster range, quality range,
// and how many locations it spawns at. Searchable by name and sortable by any
// column. Sits between the preview and the settings panel; collapses to a thin
// vertical tab. Pure read-only view of the loaded table.

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

import type { SignatureTable } from '../../core';

interface OreRow {
  key: string;
  name: string;
  signature: number;
  min: number;
  max: number;
  qMin?: number;
  qMax?: number;
  qSort: number;
  locations: number;
}

type SortKey = 'name' | 'signature' | 'max' | 'quality' | 'locations';

function buildRows(table: SignatureTable): OreRow[] {
  return table.deposits.map((d, i) => {
    const mat =
      d.materials?.find((m) => m.name.toLowerCase().startsWith(d.name.toLowerCase())) ?? d.materials?.[0];
    return {
      key: `${d.name}-${d.signature}-${i}`,
      name: d.name,
      signature: d.signature,
      min: d.clustering.minSize,
      max: d.clustering.maxSize,
      qMin: mat?.qualityMin,
      qMax: mat?.qualityMax,
      qSort: mat?.mean ?? mat?.qualityMax ?? -1,
      locations: d.locations.length,
    };
  });
}

const COLS: Array<{ key: SortKey; label: string; w: number; align?: 'right' }> = [
  { key: 'name', label: 'Ore', w: 0 },
  { key: 'signature', label: 'RS', w: 56, align: 'right' },
  { key: 'max', label: 'Cluster', w: 56, align: 'right' },
  { key: 'quality', label: 'Quality', w: 70, align: 'right' },
  { key: 'locations', label: 'Loc', w: 34, align: 'right' },
];

export function OreReference({ table }: { table: SignatureTable }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('signature');
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => buildRows(table), [table]);
  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
    const dir = desc ? -1 : 1;
    const val = (r: OreRow): number | string =>
      sortKey === 'name'
        ? r.name.toLowerCase()
        : sortKey === 'signature'
          ? r.signature
          : sortKey === 'max'
            ? r.max
            : sortKey === 'quality'
              ? r.qSort
              : r.locations;
    return [...filtered].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, q, sortKey, desc]);

  const toggleSort = (key: SortKey): void => {
    if (key === sortKey) setDesc((d) => !d);
    else {
      setSortKey(key);
      setDesc(key !== 'name'); // names default A→Z, numbers high→low
    }
  };

  if (!open) {
    return (
      <button style={S.closed} onClick={() => setOpen(true)} title="Ore reference">
        <span style={S.closedLabel}>ORE REFERENCE ▸</span>
      </button>
    );
  }

  return (
    <div style={S.col}>
      <div style={S.head}>
        <span style={S.title}>Ore reference</span>
        <span style={S.count}>{view.length}</span>
        <button style={S.collapse} onClick={() => setOpen(false)} title="Collapse">
          ◂
        </button>
      </div>
      <input
        style={S.search}
        placeholder="search ore…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
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
      </div>
      <div style={S.list}>
        {view.map((r) => (
          <div key={r.key} style={S.row}>
            <span style={S.name}>{r.name}</span>
            <span style={{ ...S.cell, width: 56 }}>{r.signature}</span>
            <span style={{ ...S.cell, width: 56 }}>
              {r.min}–{r.max}
            </span>
            <span style={{ ...S.cell, width: 70 }}>
              {r.qMin != null && r.qMax != null ? `${r.qMin}–${r.qMax}` : '—'}
            </span>
            <span style={{ ...S.cell, width: 34 }}>{r.locations}</span>
          </div>
        ))}
        {view.length === 0 && <div style={S.empty}>no match</div>}
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  closed: {
    width: 30,
    flex: '0 0 auto',
    borderLeft: '1px solid #2c323d',
    background: '#16181d',
    color: '#9fb3c8',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closedLabel: { writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  col: { width: 300, flex: '0 0 auto', display: 'flex', flexDirection: 'column', borderLeft: '1px solid #2c323d', background: '#16181d', minHeight: 0 },
  head: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 6px' },
  title: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.7 },
  count: { fontSize: 11, opacity: 0.45, fontVariantNumeric: 'tabular-nums' },
  collapse: { marginLeft: 'auto', background: 'none', border: '1px solid #3a4150', borderRadius: 6, color: '#9fb3c8', cursor: 'pointer', padding: '2px 8px', fontSize: 12 },
  search: { margin: '0 12px 8px', background: '#0d0f12', color: '#e6e6e6', border: '1px solid #3a4150', borderRadius: 6, padding: '6px 8px', fontSize: 13 },
  headerRow: { display: 'flex', gap: 6, padding: '0 12px 4px', borderBottom: '1px solid #2c323d' },
  th: { background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, fontVariantNumeric: 'tabular-nums' },
  list: { flex: 1, overflowY: 'auto', padding: '4px 12px 12px' },
  row: { display: 'flex', gap: 6, alignItems: 'baseline', padding: '4px 0', borderBottom: '1px solid #1d2128', fontSize: 12 },
  name: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 },
  cell: { flex: '0 0 auto', textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.85 },
  empty: { padding: 16, textAlign: 'center', opacity: 0.4, fontSize: 12 },
};

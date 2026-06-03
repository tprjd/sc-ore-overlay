// Presentational "scanned rock" card — pure, no IPC/window logic. Shared by the
// ScanOverlay window (ScanOverlay.tsx) and the control window's live preview
// (ScanView Overlay tab), so the preview can't drift from what ships.
//
// After a rock is scanned, shows how much of each content there is — SCU from
// the composition (percent × total SCU) — alongside per-material quality.
// Rows sorted by SCU desc (inert last), per-row percent fill, quality color
// bands, dimmed inert rows.

import type { CSSProperties } from 'react';
import type { OverlayConfig, ScanSort, SortDir } from '../shared/bridge';
import { cleanMaterial } from '../core';
import type { ScanResult, ScanComposition } from '../core';

const COLORS = {
  accent: '#f0abfc',
  scu: '#6ee7b7',
  text: '#e6e6e6',
  dim: '#9fb3c8',
  inert: '#6b7280',
  qualTop: '#fde047', // gold (≥900) — premium
  qualVHigh: '#22d3ee', // cyan (≥700)
  qualHigh: '#34d399', // green (≥500)
  qualMid: '#fbbf24', // amber (≥200)
  qualLow: '#f87171', // red (<200)
  barFill: 'rgba(240,171,252,0.18)',
  barFillInert: 'rgba(120,120,120,0.12)',
};

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(13,15,18,${alpha})`;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function isInert(material: string): boolean {
  return /\binert\b/i.test(material);
}

function qualBold(q: number): boolean {
  return q >= 700;
}

// Heuristic quality bands. Real quality values seen on rocks roughly 0..1000;
// premium picks (≥900) get a distinct color so a great rock is unmistakeable.
function qualityColor(q: number): string {
  if (q <= 0) return COLORS.dim;
  if (q >= 900) return COLORS.qualTop;
  if (q >= 700) return COLORS.qualVHigh;
  if (q >= 500) return COLORS.qualHigh;
  if (q >= 200) return COLORS.qualMid;
  return COLORS.qualLow;
}

function fmtNum(n: number | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// In edit mode the whole card is a drag region. Not typed on CSSProperties.
const DRAG_REGION = { WebkitAppRegion: 'drag' } as unknown as CSSProperties;
// Header cells opt out of the drag region so a click sorts (not moves the window).
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties;

export interface ScanCardProps {
  scan: ScanResult | null;
  config: OverlayConfig;
  /** Real window only: dashed border + drag region. Always false in preview. */
  editing?: boolean;
  /** When set, headers become clickable; called with the next column + direction. */
  onSortChange?: (sort: ScanSort, dir: SortDir) => void;
}

export function ScanCard({ scan, config, editing = false, onSortChange }: ScanCardProps) {
  const cardBg = hexToRgba(config.bgColor, config.bgOpacity);
  const sort = config.scanSort ?? 'scu';
  const dir = config.scanSortDir ?? 'desc';
  const metric = (r: ScanComposition): number =>
    sort === 'quality' ? r.quality : sort === 'percent' ? r.percent : r.scu ?? r.percent;

  // Sort rows: inert always pinned last (regardless of direction); otherwise by
  // the chosen column in the chosen direction.
  const rows: ScanComposition[] = scan
    ? [...scan.composition].sort((a, b) => {
        const aI = isInert(a.material) ? 1 : 0;
        const bI = isInert(b.material) ? 1 : 0;
        if (aI !== bI) return aI - bI;
        const cmp = metric(a) - metric(b);
        return dir === 'asc' ? cmp : -cmp;
      })
    : [];

  const sortable = !!onSortChange;
  // 3-click cycle on a column: desc → asc → reset to the default (SCU desc).
  const cycle = (col: ScanSort): void => {
    if (!onSortChange) return;
    if (sort !== col) onSortChange(col, 'desc');
    else if (dir === 'desc') onSortChange(col, 'asc');
    else onSortChange('scu', 'desc');
  };
  const headCell = (col: ScanSort, label: string, style: CSSProperties) => {
    const active = sort === col;
    return (
      <span
        style={{
          ...style,
          ...(sortable ? { ...NO_DRAG, cursor: 'pointer' } : null),
          ...(active ? { color: COLORS.accent, opacity: 1 } : null),
        }}
        onClick={sortable ? () => cycle(col) : undefined}
        title={sortable ? `Sort by ${label}` : undefined}
      >
        {label}
        {active ? (dir === 'asc' ? ' ▴' : ' ▾') : ''}
      </span>
    );
  };

  const useful = rows
    .filter((r) => !isInert(r.material))
    .reduce((acc, r) => acc + (r.scu ?? 0), 0);

  return (
    <div
      style={{
        ...S.card,
        fontFamily: config.fontFamily,
        padding: config.padding,
        background: cardBg,
        border: editing
          ? '1px dashed rgba(240,171,252,0.85)'
          : config.border
            ? '1px solid rgba(240,171,252,0.3)'
            : 'none',
        ...(editing ? DRAG_REGION : null),
      }}
    >
      {scan ? (
        <>
          <div style={S.titleRow}>
            <span style={S.title}>{scan.ore}</span>
            <span style={S.totals}>
              <span style={S.scuVal}>{fmtNum(scan.scu, 2)}</span>
              <span style={S.scuUnit}> SCU</span>
              {useful > 0 && useful < (scan.scu ?? 0) && (
                <span style={S.usefulDim}> · {fmtNum(useful, 2)} useful</span>
              )}
            </span>
          </div>
          <div style={S.stats}>
            <span style={S.statItem}>
              <span style={S.statLbl}>M</span> {fmtNum(scan.mass)}
            </span>
            <span style={S.statItem}>
              <span style={S.statLbl}>R</span>{' '}
              {scan.resistance != null ? `${scan.resistance}%` : '—'}
            </span>
            <span style={S.statItem}>
              <span style={S.statLbl}>I</span> {fmtNum(scan.instability, 2)}
            </span>
          </div>
          <div style={S.head}>
            {headCell('percent', '%', S.colPct)}
            <span style={S.colMat}>content</span>
            {headCell('quality', 'qual', S.colQual)}
            {headCell('scu', 'SCU', S.colScu)}
          </div>
          {rows.map((c, i) => {
            const inert = isInert(c.material);
            const pct = Math.min(100, Math.max(0, c.percent));
            return (
              <div key={`${c.material}-${i}`} style={S.row}>
                <div
                  style={{
                    ...S.bar,
                    width: `${pct}%`,
                    background: inert ? COLORS.barFillInert : COLORS.barFill,
                  }}
                />
                <span style={{ ...S.colPct, color: inert ? COLORS.inert : COLORS.accent }}>
                  {c.percent.toFixed(2)}%
                </span>
                <span
                  style={{
                    ...S.colMat,
                    color: inert ? COLORS.inert : COLORS.text,
                    fontStyle: inert ? 'italic' : 'normal',
                  }}
                  title={c.material}
                >
                  {cleanMaterial(c.material)}
                </span>
                <span
                  style={{
                    ...S.colQual,
                    color: inert ? COLORS.inert : qualityColor(c.quality),
                    fontWeight: !inert && qualBold(c.quality) ? 700 : 500,
                  }}
                >
                  {c.quality > 0 ? fmtNum(c.quality) : '—'}
                </span>
                <span style={{ ...S.colScu, color: inert ? COLORS.inert : COLORS.scu }}>
                  {c.scu != null ? c.scu.toFixed(2) : '—'}
                </span>
              </div>
            );
          })}
        </>
      ) : (
        <div style={S.placeholder}>waiting for scan…</div>
      )}
    </div>
  );
}

const text: CSSProperties = { color: COLORS.text, textShadow: '0 1px 3px rgba(0,0,0,0.9)' };
const tabular: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

const S: Record<string, CSSProperties> = {
  card: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
    boxSizing: 'border-box',
    overflow: 'auto',
    backdropFilter: 'blur(2px)',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 2,
  },
  title: { ...text, fontSize: 16, fontWeight: 700, color: COLORS.accent, letterSpacing: 0.2 },
  totals: { ...text, ...tabular, fontSize: 12 },
  scuVal: { color: COLORS.scu, fontWeight: 700, fontSize: 14 },
  scuUnit: { color: COLORS.scu, opacity: 0.7, fontSize: 11 },
  usefulDim: { color: COLORS.dim, fontSize: 11 },
  stats: {
    ...text,
    ...tabular,
    display: 'flex',
    gap: 12,
    fontSize: 11,
    color: COLORS.dim,
    margin: '0 0 6px',
    paddingBottom: 4,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  statItem: { display: 'inline-flex', gap: 4, alignItems: 'baseline' },
  statLbl: {
    color: COLORS.accent,
    opacity: 0.7,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 700,
  },
  head: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    opacity: 0.5,
    margin: '0 0 3px',
    ...text,
  },
  row: {
    position: 'relative',
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 13,
    padding: '2px 4px',
    borderRadius: 3,
    ...text,
  },
  bar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 3,
    pointerEvents: 'none',
    zIndex: 0,
  },
  colPct: {
    width: 56,
    textAlign: 'right',
    fontWeight: 600,
    position: 'relative',
    zIndex: 1,
    ...tabular,
  },
  colMat: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    position: 'relative',
    zIndex: 1,
  },
  colQual: {
    width: 48,
    textAlign: 'right',
    position: 'relative',
    zIndex: 1,
    ...tabular,
  },
  colScu: {
    width: 56,
    textAlign: 'right',
    fontWeight: 600,
    position: 'relative',
    zIndex: 1,
    ...tabular,
  },
  placeholder: { ...text, fontSize: 12, color: COLORS.dim, fontStyle: 'italic' },
};

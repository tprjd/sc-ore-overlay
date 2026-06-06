// Presentational ore-detail card — pure, no IPC/window logic. Shared by the
// Detail overlay window (Detail.tsx) and the control window's live preview
// (Prospect Overlay tab), so the preview can't drift from what ships.
//
// Renders the top candidate's quality breakdown: possible qualities + the
// spread (mean ± std-dev) + composition, scoped to the selected location.
// Per-row %-width bar, quality color bands (red/amber/green/cyan/gold), tabular
// numerics, cleaned material names; materials sorted by mean quality desc.

import type { CSSProperties } from 'react';
import type { QualityDetail } from '../core';
import { cleanMaterial } from '../core';
import type { OverlayConfig } from '../shared/bridge';

const COLORS = {
  accent: '#4fd1ff',
  text: '#e6e6e6',
  dim: '#9fb3c8',
  qualTop: '#fde047',
  qualVHigh: '#22d3ee',
  qualHigh: '#34d399',
  qualMid: '#fbbf24',
  qualLow: '#f87171',
  barFill: 'rgba(79,209,255,0.16)',
};

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(13,15,18,${alpha})`;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function qualityColor(q: number): string {
  if (q <= 0) return COLORS.dim;
  if (q >= 900) return COLORS.qualTop;
  if (q >= 700) return COLORS.qualVHigh;
  if (q >= 500) return COLORS.qualHigh;
  if (q >= 200) return COLORS.qualMid;
  return COLORS.qualLow;
}

const pct = (x?: number): string => (typeof x === 'number' ? `${Math.round(x * 100)}%` : '—');

// In edit mode the whole card is a drag region. Not typed on CSSProperties.
const DRAG_REGION = { WebkitAppRegion: 'drag' } as unknown as CSSProperties;

export interface DetailCardProps {
  detail: QualityDetail | null;
  config: OverlayConfig;
  /** Real window only: dashed border + drag region. Always false in preview. */
  editing?: boolean;
}

export function DetailCard({ detail, config, editing = false }: DetailCardProps) {
  const cardBg = hexToRgba(config.bgColor, config.bgOpacity);
  // Sort materials so the highest-yield rows read first.
  const materials = detail
    ? [...detail.materials].sort((a, b) => b.mean - a.mean || b.maxPercent - a.maxPercent)
    : [];

  return (
    <div
      style={{
        ...S.card,
        fontFamily: config.fontFamily,
        padding: config.padding,
        background: cardBg,
        border: editing
          ? '1px dashed rgba(79,209,255,0.85)'
          : config.border
            ? '1px solid rgba(79,209,255,0.25)'
            : 'none',
        ...(editing ? DRAG_REGION : null),
      }}
    >
      {detail ? (
        <>
          <div style={S.titleRow}>
            <span style={S.title}>{detail.ore}</span>
            <span style={S.sig}>RS {detail.signature.toLocaleString()}</span>
          </div>
          <div style={S.meta}>
            <span>
              <span style={S.metaLbl}>nodes</span> {detail.clusterMin}–{detail.clusterMax}
              {detail.clusterProbability != null && (
                <span style={S.dim}> ({pct(detail.clusterProbability)})</span>
              )}
            </span>
            {detail.location && (
              <span>
                <span style={S.metaLbl}>at</span> {detail.location.name}
                {detail.location.type ? ` (${detail.location.type})` : ''}{' '}
                <span style={S.dim}>
                  · spawn {pct(detail.location.spawn)} · occ {pct(detail.location.occurrence)}
                </span>
              </span>
            )}
          </div>
          {materials.length > 0 && (
            <>
              <div style={S.head}>
                <span style={S.colPct}>%</span>
                <span style={S.colMat}>content</span>
                <span style={S.colQual}>quality</span>
                <span style={S.colMean}>μ</span>
              </div>
              {materials.map((m, i) => {
                const midPct = (m.minPercent + m.maxPercent) / 2;
                return (
                  <div key={`${m.name}-${i}`} style={S.row}>
                    <div style={{ ...S.bar, width: `${Math.min(100, midPct)}%` }} />
                    <span style={S.colPct}>
                      {m.minPercent}–{m.maxPercent}%
                    </span>
                    <span style={S.colMat} title={m.name}>
                      {cleanMaterial(m.name)}
                    </span>
                    <span
                      style={{
                        ...S.colQual,
                        color: qualityColor(m.mean),
                        fontWeight: m.mean >= 700 ? 700 : 500,
                      }}
                    >
                      {m.qualityMin}–{m.qualityMax}
                    </span>
                    <span style={S.colMean}>
                      {Math.round(m.mean)}
                      <span style={S.dim}>±{Math.round(m.stddev)}</span>
                    </span>
                  </div>
                );
              })}
              {materials.some((m) => m.quantized.length > 0) && (
                <div style={S.quantizedBlock}>
                  <div style={S.quantizedHead}>Reported qualities</div>
                  {materials.map(
                    (m, i) =>
                      m.quantized.length > 0 && (
                        <div key={`q-${i}`} style={S.quantizedRow}>
                          <span style={S.quantizedName} title={m.name}>
                            {cleanMaterial(m.name)}
                          </span>
                          <span style={S.chipRow}>
                            {m.quantized.map((q) => (
                              <span
                                key={q}
                                style={{
                                  ...S.chip,
                                  color: qualityColor(q),
                                  borderColor: qualityColor(q),
                                }}
                              >
                                {q}
                              </span>
                            ))}
                          </span>
                        </div>
                      ),
                  )}
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div style={S.placeholder}>no detail</div>
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
  },
  titleRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 2,
  },
  title: { ...text, fontSize: 16, fontWeight: 700, color: '#ffffff', letterSpacing: 0.2 },
  sig: { ...text, ...tabular, fontSize: 12, color: COLORS.accent, fontWeight: 600 },
  meta: {
    ...text,
    ...tabular,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    fontSize: 11,
    margin: '0 0 6px',
    paddingBottom: 4,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
  },
  metaLbl: {
    color: COLORS.accent,
    opacity: 0.7,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: 700,
    marginRight: 4,
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
    fontSize: 12,
    padding: '2px 4px',
    borderRadius: 3,
    ...text,
  },
  bar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    background: COLORS.barFill,
    borderRadius: 3,
    pointerEvents: 'none',
    zIndex: 0,
  },
  colPct: {
    width: 68,
    textAlign: 'right',
    color: COLORS.accent,
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
    width: 72,
    textAlign: 'right',
    position: 'relative',
    zIndex: 1,
    ...tabular,
  },
  colMean: {
    width: 56,
    textAlign: 'right',
    color: COLORS.dim,
    position: 'relative',
    zIndex: 1,
    ...tabular,
  },
  quantizedBlock: { marginTop: 6, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.08)' },
  quantizedHead: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    opacity: 0.5,
    margin: '0 0 4px',
    ...text,
  },
  quantizedRow: {
    ...text,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
    fontSize: 11,
  },
  quantizedName: {
    width: 100,
    flexShrink: 0,
    color: COLORS.dim,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 3 },
  chip: {
    fontSize: 10,
    padding: '1px 5px',
    border: '1px solid currentColor',
    borderRadius: 3,
    background: 'rgba(0,0,0,0.25)',
    ...tabular,
    fontWeight: 600,
  },
  placeholder: { ...text, fontSize: 12, color: COLORS.dim, fontStyle: 'italic' },
  dim: { color: COLORS.dim, fontSize: 10 },
};

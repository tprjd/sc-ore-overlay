// The second transparent, click-through overlay box: per-location ore detail.
// Receives the same payload as the main overlay (over IPC) and renders the top
// candidate's quality breakdown — possible qualities ("Received") + the spread
// (mean ± std-dev) + composition, scoped to the selected location. Shown only
// when the overlay config's `showDetail` is on. Shares appearance/edit/hotkeys
// with the main overlay; its own window has independent position/size.
//
// Layout decisions match the scan-overlay polish: per-row %-width bar, quality
// color bands (red/amber/green/cyan/gold), tabular numerics, cleaned material
// names. Materials are sorted by mean quality descending so the highest-yield
// pick reads first.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import type { OverlayConfig } from '../shared/bridge';
import { cleanMaterial } from '../core';
import type { QualityDetail } from '../core';

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

export function Detail() {
  const [detail, setDetail] = useState<QualityDetail | null>(null);
  const [config, setConfig] = useState<OverlayConfig>(DEFAULT_OVERLAY_CONFIG);
  const [editing, setEditing] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [idle, setIdle] = useState(true);

  const idleMsRef = useRef(DEFAULT_OVERLAY_CONFIG.idleMs);
  const idleTimer = useRef<number | null>(null);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const sco = window.sco;
    if (!sco) return;

    const armIdle = (): void => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      setIdle(false);
      const ms = idleMsRef.current;
      if (ms > 0) idleTimer.current = window.setTimeout(() => setIdle(true), ms);
    };

    void sco.getSettings().then((s) => {
      const cfg: OverlayConfig = { ...DEFAULT_OVERLAY_CONFIG, ...(s.overlay ?? {}) };
      idleMsRef.current = cfg.idleMs;
      setConfig(cfg);
    });

    const offMatches = sco.onMatches((next) => {
      // Don't clear the detail on void ticks — the main overlay does the same,
      // so they stay in sync and the box doesn't blink between OCR cycles.
      if (next.detail == null && next.reading == null && next.candidates.length === 0) return;
      setDetail(next.detail ?? null);
      armIdle();
    });
    const offEdit = sco.onEditMode(setEditing);
    const offConfig = sco.onOverlayConfig((cfg) => {
      idleMsRef.current = cfg.idleMs;
      setConfig(cfg);
      armIdle();
    });
    const offToggle = sco.onToggleVisible(() => setHidden((h) => !h));

    return () => {
      offMatches();
      offEdit();
      offConfig();
      offToggle();
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, []);

  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeStart.current = { x: e.screenX, y: e.screenY, w: window.innerWidth, h: window.innerHeight };
  };
  const onGripMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const start = resizeStart.current;
    if (!start) return;
    window.sco?.resizeDetail?.({
      width: Math.max(220, start.w + (e.screenX - start.x)),
      height: Math.max(100, start.h + (e.screenY - start.y)),
    });
  };
  const onGripUp = (): void => {
    resizeStart.current = null;
  };

  const visible =
    editing || (!hidden && config.showDetail && detail != null && (config.idleMs <= 0 || !idle));
  const cardBg = hexToRgba(config.bgColor, config.bgOpacity);

  // Sort materials so the highest-yield rows read first.
  const materials = detail
    ? [...detail.materials].sort((a, b) => b.mean - a.mean || b.maxPercent - a.maxPercent)
    : [];

  return (
    <div style={{ ...S.root, opacity: visible ? 1 : 0, fontFamily: config.fontFamily }}>
      <div
        style={{
          ...S.card,
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
      {editing && (
        <div style={GRIP} onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} />
      )}
    </div>
  );
}

const DRAG_REGION = { WebkitAppRegion: 'drag' } as unknown as CSSProperties;
const GRIP = {
  WebkitAppRegion: 'no-drag',
  position: 'absolute',
  right: 1,
  bottom: 1,
  width: 16,
  height: 16,
  cursor: 'nwse-resize',
  borderRight: '3px solid rgba(79,209,255,0.9)',
  borderBottom: '3px solid rgba(79,209,255,0.9)',
  borderBottomRightRadius: 6,
} as unknown as CSSProperties;

const text: CSSProperties = { color: COLORS.text, textShadow: '0 1px 3px rgba(0,0,0,0.9)' };
const tabular: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

const S: Record<string, CSSProperties> = {
  root: {
    position: 'relative',
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden',
    transition: 'opacity 400ms ease',
  },
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
  quantizedRow: { ...text, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 11 },
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

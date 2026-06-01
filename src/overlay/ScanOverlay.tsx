// The "scanned rock" transparent, click-through overlay box. Receives the same
// payload as the main overlay (over IPC) and, after a rock is scanned, shows how
// much of each content there is — SCU computed from the composition percentages
// (percent × total SCU) — alongside the per-material quality. Shown only when the
// overlay config's `showScan` is on. Shares appearance/edit/hotkeys with the main
// overlay; its own window has independent position/size.
//
// Readability decisions:
//   * Composition rows are sorted by SCU descending (best content first).
//   * Each row has a subtle percent-width fill so the dominant materials pop.
//   * INERT MATERIALS rows are dimmed — they aren't yield.
//   * Quality is color-graded (low/mid/high) for instant "is this a good rock"
//     judgement without needing to read the number.
//   * Rock stats (mass / resistance / instability) get a one-line sub-header.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import type { OverlayConfig } from '../shared/bridge';
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

export function ScanOverlay() {
  const [scan, setScan] = useState<ScanResult | null>(null);
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
      setScan(next.scan ?? null);
      // Only re-arm idle on real content so an empty payload still fades.
      if (next.scan != null) armIdle();
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
    window.sco?.resizeScan?.({
      width: Math.max(220, start.w + (e.screenX - start.x)),
      height: Math.max(100, start.h + (e.screenY - start.y)),
    });
  };
  const onGripUp = (): void => {
    resizeStart.current = null;
  };

  const visible =
    editing || (!hidden && config.showScan && scan != null && (config.idleMs <= 0 || !idle));
  const cardBg = hexToRgba(config.bgColor, config.bgOpacity);

  // Sort rows: inert always last; otherwise SCU desc (fallback percent).
  const rows: ScanComposition[] = scan
    ? [...scan.composition].sort((a, b) => {
        const aI = isInert(a.material) ? 1 : 0;
        const bI = isInert(b.material) ? 1 : 0;
        if (aI !== bI) return aI - bI;
        const aS = a.scu ?? a.percent;
        const bS = b.scu ?? b.percent;
        return bS - aS;
      })
    : [];

  const useful = rows
    .filter((r) => !isInert(r.material))
    .reduce((acc, r) => acc + (r.scu ?? 0), 0);

  return (
    <div style={{ ...S.root, opacity: visible ? 1 : 0, fontFamily: config.fontFamily }}>
      <div
        style={{
          ...S.card,
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
              <span style={S.colPct}>%</span>
              <span style={S.colMat}>content</span>
              <span style={S.colQual}>qual</span>
              <span style={S.colScu}>SCU</span>
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
  borderRight: '3px solid rgba(240,171,252,0.9)',
  borderBottom: '3px solid rgba(240,171,252,0.9)',
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

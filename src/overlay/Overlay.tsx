// The transparent, click-through overlay. Receives matches over IPC and renders
// the matched ore(s). The top candidate is emphasized (larger, with a
// confidence dot + score bar); additional overlap candidates are demoted below
// a divider. A pulsing dot means the temporal voter is still confirming a new
// reading (the value may change); a solid dot means it's locked. Appearance
// (idle fade, size preset, font, background, padding, line gap, signature echo)
// is live-configurable from the control window. In "edit overlay" mode the
// window is interactive: drag the body to move, drag the grip to resize.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import type { OverlayCandidate, OverlayConfig, OverlayPayload, OverlayScale } from '../shared/bridge';

const EMPTY: OverlayPayload = { reading: null, candidates: [] };

/** Font sizes per preset (padding + gap come from config). */
const SCALE: Record<OverlayScale, { font: number; muted: number }> = {
  compact: { font: 15, muted: 12 },
  normal: { font: 22, muted: 14 },
  large: { font: 32, muted: 18 },
};

/** Keyframes for the confidence-dot pulse and the per-row enter animation. */
const KEYFRAMES = `
@keyframes scoDot { 0%,100% { opacity: 1; } 50% { opacity: 0.2; } }
@keyframes scoEnter { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
`;

/** "#rrggbb" + alpha → "rgba(r,g,b,a)". */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(13,15,18,${alpha})`;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The deposit signature behind a candidate: (reading − noise) / nodes. */
function signatureOf(reading: number | null, c: OverlayCandidate): number | null {
  if (reading == null || !c.nodes) return null;
  const sig = Math.round((reading - (c.noise ?? 0)) / c.nodes);
  return sig > 0 ? sig : null;
}

/** Score (0..1) → confidence-bar color. */
function scoreColor(pct: number): string {
  if (pct >= 60) return '#34d399';
  if (pct >= 30) return '#fbbf24';
  return '#f87171';
}

export function Overlay() {
  const [payload, setPayload] = useState<OverlayPayload>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [idle, setIdle] = useState(true);
  const [config, setConfig] = useState<OverlayConfig>(DEFAULT_OVERLAY_CONFIG);
  const [hidden, setHidden] = useState(false);

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
      // Always apply the latest payload — the temporal voter already absorbs
      // single null/garbage OCR frames upstream, so the values we see here
      // are intentional transitions. Re-arm idle only when there's something
      // visible so a real "scanner off" state can fade out via the timer.
      setPayload(next);
      if (next.reading != null || next.candidates.length > 0) armIdle();
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
    window.sco?.resizeOverlay?.({
      width: Math.max(140, start.w + (e.screenX - start.x)),
      height: Math.max(70, start.h + (e.screenY - start.y)),
    });
  };
  const onGripUp = (): void => {
    resizeStart.current = null;
  };

  const { reading, candidates, settling } = payload;
  const sz = SCALE[config.scale];
  const compact = config.scale === 'compact';
  const secFont = Math.max(11, Math.round(sz.font * 0.7));
  // Show whenever we have *anything* useful: candidates, or a reading (so the
  // "no match" message is visible), or — when the user has it enabled — the
  // "scanning…" placeholder. Idle fade handles eventual disappearance.
  const hasContent = candidates.length > 0 || reading != null || config.showPlaceholder;
  const visible = editing || (!hidden && hasContent && (config.idleMs <= 0 || !idle));
  const cardBg = hexToRgba(config.bgColor, config.bgOpacity);

  const top = candidates[0];
  const topPct = top ? Math.max(0, Math.min(100, Math.round(top.score * 100))) : 0;
  const topSig = top ? signatureOf(reading, top) : null;

  /** Pulsing while the voter confirms a new value; solid once locked. */
  const dot = (
    <span
      style={{
        ...S.dot,
        background: settling ? '#fbbf24' : '#4fd1ff',
        animation: settling ? 'scoDot 1s ease-in-out infinite' : 'none',
      }}
    />
  );

  return (
    <div style={{ ...S.root, opacity: visible ? 1 : 0, fontFamily: config.fontFamily }}>
      <style>{KEYFRAMES}</style>
      <div
        style={{
          ...S.card,
          padding: config.padding,
          gap: config.gap,
          background: cardBg,
          border: editing
            ? '1px dashed rgba(79,209,255,0.85)'
            : config.border
              ? '1px solid rgba(79,209,255,0.25)'
              : 'none',
          ...(editing ? DRAG_REGION : null),
        }}
      >
        {top && compact ? (
          // Compact: top candidate only, on a single line.
          <div key={`${top.name}-${top.noise ?? 'n'}-${top.loose ? 'L' : 'S'}`} style={{ ...S.row, animation: 'scoEnter 160ms ease-out' }}>
            {dot}
            <span style={{ ...S.name, fontSize: sz.font }}>{top.name}</span>
            <span style={{ ...S.nodes, fontSize: sz.font }}>×{top.nodes}</span>
          </div>
        ) : top ? (
          <>
            {/* Primary candidate — emphasized. */}
            <div key={`${top.name}-${top.noise ?? 'n'}-${top.loose ? 'L' : 'S'}`} style={{ ...S.primaryBlock, animation: 'scoEnter 160ms ease-out' }}>
              <div style={S.row}>
                {dot}
                <span style={{ ...S.name, fontSize: sz.font }}>
                  {top.name}
                  {top.noise != null && (
                    <span style={{ ...S.noiseBadge, fontSize: Math.max(10, sz.font * 0.45) }}>
                      +{top.noise.toLocaleString()}
                    </span>
                  )}
                  {top.loose && (
                    <span style={{ ...S.looseBadge, fontSize: Math.max(10, sz.font * 0.45) }}>loose</span>
                  )}
                </span>
                <span style={{ ...S.nodes, fontSize: sz.font }}>×{top.nodes}</span>
              </div>
              {config.showSignature && topSig != null && (
                <div style={{ ...S.sig, fontSize: Math.max(9, Math.round(sz.muted * 0.85)) }}>
                  {topSig.toLocaleString()}×{top.nodes}
                </div>
              )}
              <div style={S.bar}>
                <div style={{ ...S.barFill, width: `${topPct}%`, background: scoreColor(topPct) }} />
              </div>
            </div>

            {/* Secondary overlap candidates — demoted below a divider. */}
            {candidates.length > 1 && <div style={S.divider} />}
            {candidates.slice(1).map((c, i) => {
              const sig = signatureOf(reading, c);
              return (
                <div
                  key={`${c.name}-${c.noise ?? 'n'}-${c.loose ? 'L' : 'S'}-${i}`}
                  style={{ ...S.secRow, animation: 'scoEnter 160ms ease-out' }}
                >
                  <span style={{ ...S.secName, fontSize: secFont }}>
                    {c.name}
                    {c.noise != null && (
                      <span style={{ ...S.noiseBadge, fontSize: Math.max(9, secFont * 0.5) }}>
                        +{c.noise.toLocaleString()}
                      </span>
                    )}
                    {c.loose && (
                      <span style={{ ...S.looseBadge, fontSize: Math.max(9, secFont * 0.5) }}>loose</span>
                    )}
                    {config.showSignature && sig != null && (
                      <span style={S.secSig}>
                        {' '}
                        {sig.toLocaleString()}×{c.nodes}
                      </span>
                    )}
                  </span>
                  <span style={{ ...S.secNodes, fontSize: secFont }}>×{c.nodes}</span>
                </div>
              );
            })}
          </>
        ) : reading != null ? (
          // Number is on screen but matches nothing — always show this; it's
          // diagnostic, not a "placeholder". showPlaceholder gates only the
          // truly-empty "scanning…" state below.
          <div style={{ ...S.muted, fontSize: sz.muted }}>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: '#e6e6e6' }}>
              {reading.toLocaleString()}
            </span>{' '}
            — no match
          </div>
        ) : config.showPlaceholder ? (
          // Settling = the voter is accumulating a value but hasn't locked yet
          // (or is re-locking a changed reading), so `stableRs` is null and no
          // candidate is shown. Surface that with a pulsing dot + "locking…".
          <div style={{ ...S.muted, fontSize: sz.muted, display: 'flex', alignItems: 'center' }}>
            {settling && dot}
            {settling ? 'locking…' : 'scanning…'}
          </div>
        ) : null}
      </div>
      {editing && (
        <div style={GRIP} onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} />
      )}
    </div>
  );
}

// In edit mode the whole card is a drag region — move the window by dragging the
// body (the grip below is `no-drag`, so it resizes instead). The dashed border
// signals edit mode; instructions live in the control window's Overlay panel.
// `-webkit-app-region` isn't typed on React.CSSProperties, hence the cast.
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

const S: Record<string, CSSProperties> = {
  root: {
    position: 'relative',
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
  card: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'flex-start',
    overflow: 'hidden',
    backdropFilter: 'blur(2px)',
    boxSizing: 'border-box',
  },
  primaryBlock: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 },
  row: { display: 'flex', alignItems: 'baseline', lineHeight: 1.1, minWidth: 0 },
  dot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flex: '0 0 auto',
    alignSelf: 'center',
    marginRight: 7,
    boxShadow: '0 0 4px rgba(0,0,0,0.6)',
  },
  name: {
    fontWeight: 700,
    color: '#fff',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  nodes: {
    fontWeight: 700,
    color: '#4fd1ff',
    fontVariantNumeric: 'tabular-nums',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    marginLeft: 'auto',
    paddingLeft: 8,
  },
  sig: {
    color: '#9fb3c8',
    fontVariantNumeric: 'tabular-nums',
    paddingLeft: 14,
    textShadow: '0 1px 2px rgba(0,0,0,0.9)',
    lineHeight: 1,
  },
  bar: {
    height: 3,
    borderRadius: 2,
    background: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
    marginLeft: 14,
  },
  barFill: { height: '100%', borderRadius: 2, transition: 'width 200ms ease-out, background 200ms' },
  divider: { height: 1, background: 'rgba(255,255,255,0.14)', margin: '1px 0' },
  secRow: { display: 'flex', alignItems: 'baseline', lineHeight: 1.1, minWidth: 0, opacity: 0.7 },
  secName: {
    fontWeight: 600,
    color: '#dbe4ee',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  secNodes: {
    fontWeight: 600,
    color: '#4fd1ff',
    fontVariantNumeric: 'tabular-nums',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    marginLeft: 'auto',
    paddingLeft: 8,
  },
  secSig: { color: '#9fb3c8', fontVariantNumeric: 'tabular-nums', fontWeight: 400, fontSize: 10 },
  muted: { color: '#9fb3c8', textShadow: '0 1px 3px rgba(0,0,0,0.9)' },
  noiseBadge: {
    marginLeft: 6,
    padding: '1px 5px',
    background: 'rgba(58,42,26,0.85)',
    color: '#fbbf24',
    border: '1px solid rgba(90,58,31,0.9)',
    borderRadius: 4,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
    verticalAlign: 'middle',
  },
  looseBadge: {
    marginLeft: 6,
    padding: '1px 5px',
    background: 'rgba(42,26,58,0.85)',
    color: '#c084fc',
    border: '1px solid rgba(74,42,90,0.9)',
    borderRadius: 4,
    fontWeight: 600,
    verticalAlign: 'middle',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
};

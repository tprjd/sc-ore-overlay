// The transparent, click-through overlay. Receives matches over IPC and renders
// "Ore ×N" (stacked on overlap). Appearance (idle fade-out delay + size preset)
// is live-configurable from the control window; the window itself is resizable
// (drag the edges in "edit overlay" mode) and the card fills it.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import type { OverlayConfig, OverlayPayload, OverlayScale } from '../shared/bridge';

const EMPTY: OverlayPayload = { reading: null, candidates: [] };

/** Per-preset sizing. */
const SCALE: Record<OverlayScale, { font: number; gap: number; pad: number; muted: number }> = {
  compact: { font: 15, gap: 6, pad: 8, muted: 12 },
  normal: { font: 22, gap: 12, pad: 12, muted: 14 },
  large: { font: 32, gap: 18, pad: 16, muted: 18 },
};

export function Overlay() {
  const [payload, setPayload] = useState<OverlayPayload>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [idle, setIdle] = useState(true);
  const [config, setConfig] = useState<OverlayConfig>(DEFAULT_OVERLAY_CONFIG);

  const idleMsRef = useRef(DEFAULT_OVERLAY_CONFIG.idleMs);
  const idleTimer = useRef<number | null>(null);

  useEffect(() => {
    const sco = window.sco;
    if (!sco) return;

    // (Re)start the idle timer using the latest configured delay.
    const armIdle = (): void => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      setIdle(false);
      const ms = idleMsRef.current;
      if (ms > 0) idleTimer.current = window.setTimeout(() => setIdle(true), ms);
    };

    void sco.getSettings().then((s) => {
      const cfg: OverlayConfig = {
        idleMs: s.overlayIdleMs ?? DEFAULT_OVERLAY_CONFIG.idleMs,
        scale: s.overlayScale ?? DEFAULT_OVERLAY_CONFIG.scale,
      };
      idleMsRef.current = cfg.idleMs;
      setConfig(cfg);
    });

    const offMatches = sco.onMatches((next) => {
      setPayload(next);
      armIdle();
    });
    const offEdit = sco.onEditMode(setEditing);
    const offConfig = sco.onOverlayConfig((cfg) => {
      idleMsRef.current = cfg.idleMs;
      setConfig(cfg);
      armIdle();
    });

    return () => {
      offMatches();
      offEdit();
      offConfig();
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, []);

  const { reading, candidates } = payload;
  const sz = SCALE[config.scale];
  // Never fade when idleMs <= 0; otherwise fade once idle (unless editing).
  const visible = editing || config.idleMs <= 0 || !idle;

  return (
    <div style={{ ...S.root, opacity: visible ? 1 : 0 }}>
      {editing && <div style={DRAG}>⠿ drag to move · resize edges · Alt+Shift+E to lock</div>}
      <div style={{ ...S.card, padding: sz.pad, gap: sz.gap, ...(editing ? S.cardEditing : null) }}>
        {candidates.length > 0 ? (
          candidates.map((c, i) => (
            <div key={c.name} style={{ ...S.row, gap: sz.gap, opacity: i === 0 ? 1 : 0.85 }}>
              <span style={{ ...S.name, fontSize: sz.font }}>{c.name}</span>
              <span style={{ ...S.nodes, fontSize: sz.font }}>×{c.nodes}</span>
            </div>
          ))
        ) : (
          <div style={{ ...S.muted, fontSize: sz.muted }}>
            {reading != null ? `${reading} — no match` : 'scanning…'}
          </div>
        )}
      </div>
    </div>
  );
}

// `-webkit-app-region: drag` moves the frameless window (only reachable in edit
// mode, when the window is interactive). Cast because React.CSSProperties
// doesn't type the non-standard property.
const DRAG = {
  WebkitAppRegion: 'drag',
  fontSize: 11,
  color: '#9fb3c8',
  background: 'rgba(13,15,18,0.85)',
  padding: '3px 8px',
  borderRadius: 6,
  textAlign: 'center',
  flex: '0 0 auto',
} as unknown as CSSProperties;

const S: Record<string, CSSProperties> = {
  root: {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    padding: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    transition: 'opacity 400ms ease',
  },
  card: {
    flex: 1,
    minHeight: 0,
    background: 'rgba(13,15,18,0.55)',
    border: '1px solid rgba(79,209,255,0.25)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    overflow: 'hidden',
    backdropFilter: 'blur(2px)',
    boxSizing: 'border-box',
  },
  cardEditing: { border: '1px dashed rgba(79,209,255,0.8)' },
  row: { display: 'flex', alignItems: 'baseline', lineHeight: 1.3, minWidth: 0 },
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
  muted: { color: '#9fb3c8', textShadow: '0 1px 3px rgba(0,0,0,0.9)' },
};

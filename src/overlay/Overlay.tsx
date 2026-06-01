// The transparent, click-through overlay. Receives matches over IPC and renders
// "Ore ×N" (stacked on overlap). Appearance (idle fade, size preset, font,
// background color + opacity, padding, line gap) is live-configurable from the
// control window. In "edit overlay" mode the window is interactive: drag the
// body to move, drag the bottom-right grip to resize. The drag bar is an overlay
// (out of layout flow) so toggling edit mode never resizes the content.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import type { OverlayConfig, OverlayPayload, OverlayScale } from '../shared/bridge';

const EMPTY: OverlayPayload = { reading: null, candidates: [] };

/** Font sizes per preset (padding + gap come from config). */
const SCALE: Record<OverlayScale, { font: number; muted: number }> = {
  compact: { font: 15, muted: 12 },
  normal: { font: 22, muted: 14 },
  large: { font: 32, muted: 18 },
};

/** "#rrggbb" + alpha → "rgba(r,g,b,a)". */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(13,15,18,${alpha})`;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
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
      setPayload(next);
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
    window.sco?.resizeOverlay?.({
      width: Math.max(140, start.w + (e.screenX - start.x)),
      height: Math.max(70, start.h + (e.screenY - start.y)),
    });
  };
  const onGripUp = (): void => {
    resizeStart.current = null;
  };

  const { reading, candidates } = payload;
  const sz = SCALE[config.scale];
  // Only show when we actually have an RS number. No reading → no box.
  // With a number but no match the placeholder reads "<reading> — no match".
  const hasContent = reading != null && (candidates.length > 0 || config.showPlaceholder);
  const visible = editing || (!hidden && hasContent && (config.idleMs <= 0 || !idle));
  const cardBg = hexToRgba(config.bgColor, config.bgOpacity);

  return (
    <div style={{ ...S.root, opacity: visible ? 1 : 0, fontFamily: config.fontFamily }}>
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
        {candidates.length > 0 ? (
          candidates.map((c, i) => (
            <div key={c.name} style={{ ...S.row, opacity: i === 0 ? 1 : 0.85 }}>
              <span style={{ ...S.name, fontSize: sz.font }}>{c.name}</span>
              <span style={{ ...S.nodes, fontSize: sz.font }}>×{c.nodes}</span>
            </div>
          ))
        ) : config.showPlaceholder ? (
          <div style={{ ...S.muted, fontSize: sz.muted }}>
            {reading != null ? `${reading} — no match` : 'scanning…'}
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
  row: { display: 'flex', alignItems: 'baseline', lineHeight: 1.1, minWidth: 0 },
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

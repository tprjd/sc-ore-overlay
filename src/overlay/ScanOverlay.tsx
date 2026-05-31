// The "scanned rock" transparent, click-through overlay box. Receives the same
// payload as the main overlay (over IPC) and, after a rock is scanned, shows how
// much of each content there is — SCU computed from the composition percentages
// (percent × total SCU) — alongside the per-material quality. Shown only when the
// overlay config's `showScan` is on. Shares appearance/edit/hotkeys with the main
// overlay; its own window has independent position/size.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import type { OverlayConfig } from '../shared/bridge';
import type { ScanResult } from '../core';

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(13,15,18,${alpha})`;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
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
    window.sco?.resizeScan?.({
      width: Math.max(160, start.w + (e.screenX - start.x)),
      height: Math.max(80, start.h + (e.screenY - start.y)),
    });
  };
  const onGripUp = (): void => {
    resizeStart.current = null;
  };

  const visible =
    editing || (!hidden && config.showScan && scan != null && (config.idleMs <= 0 || !idle));
  const cardBg = hexToRgba(config.bgColor, config.bgOpacity);

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
            <div style={S.title}>
              {scan.ore}
              {scan.scu != null && <span style={S.dim}> · {scan.scu} SCU</span>}
            </div>
            <div style={S.head}>
              <span style={S.pct}>%</span>
              <span style={S.mat}>content</span>
              <span style={S.qual}>qual</span>
              <span style={S.scu}>SCU</span>
            </div>
            {scan.composition.map((c, i) => (
              <div key={`${c.material}-${i}`} style={S.row}>
                <span style={S.pct}>{c.percent}%</span>
                <span style={S.mat}>{c.material}</span>
                <span style={S.qual}>{c.quality}</span>
                <span style={S.scu}>{c.scu != null ? c.scu.toFixed(2) : '—'}</span>
              </div>
            ))}
          </>
        ) : (
          <div style={S.dim}>no scan</div>
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

const text: CSSProperties = { color: '#e6e6e6', textShadow: '0 1px 3px rgba(0,0,0,0.9)' };
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
  title: { ...text, fontSize: 15, fontWeight: 700, color: '#f0abfc' },
  head: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    opacity: 0.5,
    margin: '4px 0 2px',
    ...text,
  },
  row: { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12, padding: '1px 0', ...text },
  pct: { width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#f0abfc' },
  mat: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  qual: { width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#c7d2dc' },
  scu: { width: 52, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#6ee7b7' },
  dim: { ...text, fontSize: 12, color: '#9fb3c8' },
};

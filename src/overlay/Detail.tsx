// The second transparent, click-through overlay box: per-location ore detail.
// Owns the window concerns only — IPC wiring, idle fade, visibility toggle, and
// the edit-mode drag/resize. The card itself (quality breakdown) is the shared
// DetailCard, so the control window's live preview always matches what ships.
// Shown only when the overlay config's `showDetail` is on.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import type { OverlayConfig } from '../shared/bridge';
import type { QualityDetail } from '../core';
import { DetailCard } from './DetailCard';

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
      // Apply every payload — the temporal voter upstream already filters
      // garbage frames, so a null detail here means the matcher genuinely
      // has no top candidate (and the user wants to see that, not the
      // stale previous one).
      setDetail(next.detail ?? null);
      if (next.detail != null) armIdle();
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

  return (
    <div style={{ ...S.root, opacity: visible ? 1 : 0 }}>
      <DetailCard detail={detail} config={config} editing={editing} />
      {editing && (
        <div style={GRIP} onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} />
      )}
    </div>
  );
}

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
    transition: 'opacity 400ms ease',
  },
};

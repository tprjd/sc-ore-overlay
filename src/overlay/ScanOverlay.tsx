// The "scanned rock" transparent, click-through overlay box. Owns the window
// concerns only — IPC wiring, idle fade, visibility toggle, and the edit-mode
// drag/resize. The card itself (SCU-per-content breakdown) is the shared
// ScanCard, so the control window's live preview always matches what ships.
// Shown only when the overlay config's `showScan` is on.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import type { OverlayConfig } from '../shared/bridge';
import type { ScanResult } from '../core';
import { ScanCard } from './ScanCard';

export function ScanOverlay() {
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [config, setConfig] = useState<OverlayConfig>(DEFAULT_OVERLAY_CONFIG);
  const [editing, setEditing] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [idle, setIdle] = useState(true);

  const idleMsRef = useRef(DEFAULT_OVERLAY_CONFIG.idleMs);
  const idleTimer = useRef<number | null>(null);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  // Auto-fit window height to the card content (width stays user-controlled).
  const contentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) window.sco?.resizeScan?.({ width: window.innerWidth, height: h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  return (
    <div ref={contentRef} style={{ ...S.root, opacity: visible ? 1 : 0 }}>
      <ScanCard
        scan={scan}
        config={config}
        editing={editing}
        // Sortable only while editing (the overlay is click-through otherwise).
        // Route through setOverlayConfig so the change persists + syncs to the
        // control window and the other boxes.
        onSortChange={
          editing
            ? (scanSort, scanSortDir) => window.sco?.setOverlayConfig?.({ ...config, scanSort, scanSortDir })
            : undefined
        }
      />
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
  borderRight: '3px solid rgba(240,171,252,0.9)',
  borderBottom: '3px solid rgba(240,171,252,0.9)',
  borderBottomRightRadius: 6,
} as unknown as CSSProperties;

const S: Record<string, CSSProperties> = {
  root: {
    position: 'relative',
    width: '100%',
    // Fits the card content; the window is auto-resized to match.
    height: 'auto',
    boxSizing: 'border-box',
    overflow: 'hidden',
    transition: 'opacity 400ms ease',
  },
};

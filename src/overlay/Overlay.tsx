// The transparent, click-through overlay window. Owns the IPC wiring, idle
// fade, visibility toggle, and the edit-mode drag/resize; the card itself
// (matched ore rendering) is the shared OverlayCard, so the control window's
// live preview always matches what ships here.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import type { OverlayConfig, OverlayPayload } from '../shared/bridge';
import { OverlayCard } from './OverlayCard';

const EMPTY: OverlayPayload = { reading: null, candidates: [], status: 'no-rs' };

export function Overlay() {
  const [payload, setPayload] = useState<OverlayPayload>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [idle, setIdle] = useState(true);
  const [config, setConfig] = useState<OverlayConfig>(DEFAULT_OVERLAY_CONFIG);
  const [hidden, setHidden] = useState(false);

  const idleMsRef = useRef(DEFAULT_OVERLAY_CONFIG.idleMs);
  const idleTimer = useRef<number | null>(null);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  // Auto-fit the window height to the card's content so the overlay is never
  // taller than what it shows. Width stays user-controlled (grip / drag).
  const contentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) window.sco?.resizeOverlay?.({ width: window.innerWidth, height: h });
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

  const { reading, candidates, settling, ocr, status } = payload;
  // Source lost → the overlay vanishes entirely, regardless of idle/content/edit.
  const sourceLost = status === 'source-lost';
  // Show whenever we have *anything* useful: candidates, or a reading (so the
  // "no match" message is visible), or — when enabled — the "scanning…"
  // placeholder. Idle fade handles eventual disappearance.
  const hasContent = candidates.length > 0 || reading != null || config.showPlaceholder;
  const visible = !sourceLost && (editing || (!hidden && hasContent && (config.idleMs <= 0 || !idle)));

  return (
    <div ref={contentRef} style={{ ...S.root, opacity: visible ? 1 : 0 }}>
      <OverlayCard reading={reading} candidates={candidates} settling={settling} ocr={ocr} status={status} config={config} editing={editing} />
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
    // Height fits the card content (the window is auto-resized to match), so the
    // overlay is never taller than what it shows.
    height: 'auto',
    boxSizing: 'border-box',
    overflow: 'hidden',
  },
};

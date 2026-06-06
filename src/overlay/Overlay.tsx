// The transparent, click-through overlay window. Owns the IPC wiring, idle
// fade, visibility toggle, and the edit-mode drag/resize; the card itself
// (matched ore rendering) is the shared OverlayCard, so the control window's
// live preview always matches what ships here.

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { OverlayConfig, OverlayPayload } from '../shared/bridge';
import { DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import { OverlayCard } from './OverlayCard';

// Start inactive (hidden) — the control window pushes a live status only once the
// Mining capture view is up, so no placeholder shows before a source is picked.
const EMPTY: OverlayPayload = { reading: null, candidates: [], status: 'inactive' };

export function Overlay() {
  const [payload, setPayload] = useState<OverlayPayload>(EMPTY);
  const [editing, setEditing] = useState(false);
  // `idle` gates the fade only; the overlay starts hidden via the 'inactive'
  // EMPTY status until the control window pushes a live capture status, so no
  // placeholder shows before a source is selected.
  const [idle, setIdle] = useState(false);
  const [config, setConfig] = useState<OverlayConfig>(DEFAULT_OVERLAY_CONFIG);
  const [hidden, setHidden] = useState(false);

  const idleMsRef = useRef(DEFAULT_OVERLAY_CONFIG.idleMs);
  const idleTimer = useRef<number | null>(null);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  // Auto-fit the window height to the card's content so the overlay is never
  // taller than what it shows. Width stays user-controlled (grip / drag).
  const contentRef = useRef<HTMLDivElement | null>(null);
  const autoResize = config.autoResize;
  useEffect(() => {
    const el = contentRef.current;
    if (!autoResize || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) window.sco?.resizeOverlay?.({ width: window.innerWidth, height: h });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [autoResize]);

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
      // Arm the fade with the real idleMs now that it's loaded, so the live
      // placeholder eventually fades instead of hanging on the default timer.
      armIdle();
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
    // Toggle-overlay hotkey: flip the hard hidden flag, and when *revealing*,
    // re-arm idle so the overlay actually reappears instead of staying gated
    // behind a long-elapsed idle timer.
    const offToggle = sco.onToggleVisible(() =>
      setHidden((h) => {
        const next = !h;
        if (!next) armIdle();
        return next;
      }),
    );

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
    resizeStart.current = {
      x: e.screenX,
      y: e.screenY,
      w: window.innerWidth,
      h: window.innerHeight,
    };
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
  // Source lost, or no live capture (no source picked / Mining view not live) →
  // the overlay vanishes entirely, regardless of idle/content/edit.
  const gone = status === 'source-lost' || status === 'inactive';
  // Show whenever we have *anything* useful: candidates, or a reading (so the
  // "no match" message is visible), or — when enabled — the "scanning…"
  // placeholder. Idle fade handles eventual disappearance.
  const hasContent = candidates.length > 0 || reading != null || config.showPlaceholder;
  const visible = !gone && (editing || (!hidden && hasContent && (config.idleMs <= 0 || !idle)));

  return (
    <div
      ref={contentRef}
      style={{ ...S.root, height: autoResize ? 'auto' : '100%', opacity: visible ? 1 : 0 }}
    >
      <OverlayCard
        reading={reading}
        candidates={candidates}
        settling={settling}
        ocr={ocr}
        status={status}
        config={config}
        editing={editing}
      />
      {editing && (
        <div
          style={GRIP}
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
        />
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

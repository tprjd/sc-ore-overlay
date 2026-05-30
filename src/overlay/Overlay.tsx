// The transparent, click-through overlay. Receives matches over IPC and renders
// "Ore ×N" (stacked on overlap), fades when idle, and shows a drag bar in
// "edit overlay" mode (toggled by a global hotkey in the main process).

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { OverlayPayload } from '../shared/bridge';

/** Fade the overlay out if no new reading arrives within this window. */
const IDLE_MS = 10_000;

const EMPTY: OverlayPayload = { reading: null, candidates: [] };

export function Overlay() {
  const [payload, setPayload] = useState<OverlayPayload>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [idle, setIdle] = useState(true);
  const idleTimer = useRef<number | null>(null);

  useEffect(() => {
    const offMatches = window.sco.onMatches((next) => {
      setPayload(next);
      setIdle(false);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
    });
    const offEdit = window.sco.onEditMode(setEditing);
    return () => {
      offMatches();
      offEdit();
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, []);

  const { reading, candidates } = payload;
  const visible = editing || !idle;

  return (
    <div style={{ ...S.root, opacity: visible ? 1 : 0 }}>
      {editing && <div style={DRAG}>⠿ drag to move · Alt+Shift+E to lock</div>}
      <div style={{ ...S.card, ...(editing ? S.cardEditing : null) }}>
        {candidates.length > 0 ? (
          candidates.map((c, i) => (
            <div key={c.name} style={{ ...S.row, opacity: i === 0 ? 1 : 0.85 }}>
              <span style={S.name}>{c.name}</span>
              <span style={S.nodes}>×{c.nodes}</span>
            </div>
          ))
        ) : (
          <div style={S.muted}>
            {reading != null ? `${reading} — no match` : 'scanning…'}
          </div>
        )}
      </div>
    </div>
  );
}

// `-webkit-app-region: drag` lets the user move the frameless window by this bar
// (only reachable in edit mode, when the window is interactive). Cast because
// React.CSSProperties doesn't type the non-standard property.
const DRAG = {
  WebkitAppRegion: 'drag',
  fontSize: 11,
  color: '#9fb3c8',
  background: 'rgba(13,15,18,0.85)',
  padding: '3px 8px',
  borderRadius: 6,
  marginBottom: 6,
  textAlign: 'center',
} as unknown as CSSProperties;

const S: Record<string, CSSProperties> = {
  root: {
    display: 'inline-block',
    padding: 8,
    transition: 'opacity 400ms ease',
  },
  card: {
    background: 'rgba(13,15,18,0.55)',
    border: '1px solid rgba(79,209,255,0.25)',
    borderRadius: 10,
    padding: '8px 14px',
    backdropFilter: 'blur(2px)',
  },
  cardEditing: { border: '1px dashed rgba(79,209,255,0.8)' },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
    lineHeight: 1.35,
  },
  name: {
    fontSize: 22,
    fontWeight: 700,
    color: '#fff',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
  },
  nodes: {
    fontSize: 22,
    fontWeight: 700,
    color: '#4fd1ff',
    fontVariantNumeric: 'tabular-nums',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    marginLeft: 'auto',
  },
  muted: {
    fontSize: 14,
    color: '#9fb3c8',
    textShadow: '0 1px 3px rgba(0,0,0,0.9)',
  },
};

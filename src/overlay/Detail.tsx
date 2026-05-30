// The second transparent, click-through overlay box: per-location ore detail.
// Receives the same payload as the main overlay (over IPC) and renders the top
// candidate's quality breakdown — possible qualities ("Received") + the spread
// (mean ± std-dev) + composition, scoped to the selected location. Shown only
// when the overlay config's `showDetail` is on. Shares appearance/edit/hotkeys
// with the main overlay; its own window has independent position/size.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import type { OverlayConfig } from '../shared/bridge';
import type { QualityDetail } from '../core';

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(13,15,18,${alpha})`;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
const pct = (x?: number): string => (typeof x === 'number' ? `${Math.round(x * 100)}%` : '—');

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
      setDetail(next.detail ?? null);
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
    window.sco?.resizeDetail?.({
      width: Math.max(160, start.w + (e.screenX - start.x)),
      height: Math.max(80, start.h + (e.screenY - start.y)),
    });
  };
  const onGripUp = (): void => {
    resizeStart.current = null;
  };

  const visible =
    editing || (!hidden && config.showDetail && detail != null && (config.idleMs <= 0 || !idle));
  const cardBg = hexToRgba(config.bgColor, config.bgOpacity);

  return (
    <div style={{ ...S.root, opacity: visible ? 1 : 0, fontFamily: config.fontFamily }}>
      <div
        style={{
          ...S.card,
          padding: config.padding,
          background: cardBg,
          border: editing
            ? '1px dashed rgba(79,209,255,0.85)'
            : config.border
              ? '1px solid rgba(79,209,255,0.25)'
              : 'none',
          ...(editing ? DRAG_REGION : null),
        }}
      >
        {detail ? (
          <>
            <div style={S.title}>
              {detail.ore} <span style={S.dim}>· RS {detail.signature}</span>
            </div>
            {detail.location && (
              <div style={S.sub}>
                {detail.location.name}
                {detail.location.type ? ` (${detail.location.type})` : ''} · spawn{' '}
                {pct(detail.location.spawn)} · occ {pct(detail.location.occurrence)}
              </div>
            )}
            <div style={S.sub}>
              cluster {detail.clusterMin}–{detail.clusterMax}
              {detail.clusterProbability != null ? ` (${pct(detail.clusterProbability)})` : ''}
            </div>
            <div style={{ ...S.sub, marginTop: 4 }}>composition (everything the rock yields):</div>
            <div style={S.table}>
              {detail.materials.map((m, i) => (
                <div key={`${m.name}-${i}`} style={S.matRow}>
                  <div style={S.matName}>{m.name}</div>
                  <div style={S.matMeta}>
                    {m.minPercent}–{m.maxPercent}% · Q {m.qualityMin}–{m.qualityMax} · μ
                    {Math.round(m.mean)}±{Math.round(m.stddev)}
                  </div>
                  <div style={S.matRecv}>qualities: {m.quantized.join(', ') || '—'}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={S.dim}>no detail</div>
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
  borderRight: '3px solid rgba(79,209,255,0.9)',
  borderBottom: '3px solid rgba(79,209,255,0.9)',
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
  title: { ...text, fontSize: 15, fontWeight: 700, color: '#fff' },
  sub: { ...text, fontSize: 11, color: '#9fb3c8' },
  table: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 },
  matRow: { ...text, fontSize: 11, lineHeight: 1.25 },
  matName: { fontWeight: 700, color: '#fff', fontSize: 12 },
  matMeta: { color: '#c7d2dc' },
  matRecv: { color: '#4fd1ff', fontVariantNumeric: 'tabular-nums' },
  dim: { ...text, fontSize: 12, color: '#9fb3c8' },
};

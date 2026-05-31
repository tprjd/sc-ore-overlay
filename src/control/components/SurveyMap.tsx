// 2D top-down, ship-centered survey map (Phase S2). The ship sits at the origin;
// each entry is plotted by its in-plane offset (project()), with depth shown on
// hover. Faint grid + concentric range rings (labeled in km), pan by drag, zoom
// by cursor-anchored wheel. Pure renderer — fed entries from the debug generator
// in S2 and from the real log in S3.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

import { distance, project } from '../../core';
import type { AxisPlane, SurveyEntry, Vec3 } from '../../core';

export interface SurveyMapProps {
  /** Map center (live ship position or the debug ship). */
  ship: Vec3 | null;
  entries: SurveyEntry[];
  plane?: AxisPlane;
}

interface View {
  /** Pixels per meter. */
  ppm: number;
  /** Pan offset of the ship from the canvas center, in css px. */
  panX: number;
  panY: number;
}

interface Hover {
  x: number;
  y: number;
  entry: SurveyEntry;
}

const km = (m: number): string => (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });

/** Stable hue per ore name. */
function oreHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Round a rough meter span to a 1/2/5 × 10ⁿ "nice" step. */
function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const f = rough / pow;
  const n = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return n * pow;
}

export function SurveyMap({ ship, entries, plane = 'xy' }: SurveyMapProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ ppm: 0.02, panX: 0, panY: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Track the rendered size (css px), DPR-aware drawing below.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    });
    ro.observe(wrap);
    setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit the view to the field whenever the data, plane, or canvas size changes.
  const shipKey = ship ? `${ship.x},${ship.y},${ship.z}` : 'none';
  useLayoutEffect(() => {
    if (!ship || size.w < 2 || size.h < 2) return;
    let maxR = 0;
    for (const e of entries) {
      const p = project(e.pos, ship, plane);
      maxR = Math.max(maxR, Math.hypot(p.x, p.y));
    }
    const span = maxR > 0 ? maxR : 10_000; // default ~10 km radius when empty
    const ppm = (Math.min(size.w, size.h) * 0.42) / span;
    setView({ ppm, panX: 0, panY: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipKey, entries, plane, size.w, size.h, fitNonce]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 2 || size.h < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, size.w, size.h, view, entries, ship, plane, hover?.entry.id ?? null);
  }, [size, view, entries, ship, plane, hover]);

  const center = (): { cx: number; cy: number } => ({ cx: size.w / 2, cy: size.h / 2 });
  const shipScreen = (): { sx: number; sy: number } => {
    const { cx, cy } = center();
    return { sx: cx + view.panX, sy: cy + view.panY };
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const { cx, cy } = center();
      const sx = cx + v.panX;
      const sy = cy + v.panY;
      const wx = (mx - sx) / v.ppm;
      const wy = (sy - my) / v.ppm;
      const ppm = Math.min(5, Math.max(1e-5, v.ppm * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      return { ppm, panX: mx - cx - wx * ppm, panY: my - cy + wy * ppm };
    });
  };

  // Non-passive wheel listener so preventDefault works.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  const hitTest = (mx: number, my: number): Hover | null => {
    if (!ship) return null;
    const { sx, sy } = shipScreen();
    let best: Hover | null = null;
    let bestD = 10; // px threshold
    for (const e of entries) {
      const p = project(e.pos, ship, plane);
      const x = sx + p.x * view.ppm;
      const y = sy - p.y * view.ppm;
      const d = Math.hypot(x - mx, y - my);
      if (d < bestD) {
        bestD = d;
        best = { x, y, entry: e };
      }
    }
    return best;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (drag.current) {
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      drag.current = { x: e.clientX, y: e.clientY };
      setView((v) => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(hitTest(e.clientX - rect.left, e.clientY - rect.top));
  };
  const onPointerUp = (): void => {
    drag.current = null;
  };

  const fit = (): void => setFitNonce((n) => n + 1); // re-run the fit effect

  const hoverInfo = hover
    ? (() => {
        const e = hover.entry;
        const depth = ship ? project(e.pos, ship, plane).depth : 0;
        const dist = ship ? distance(e.pos, ship) : 0;
        return { e, depth, dist };
      })()
    : null;

  return (
    <div ref={wrapRef} style={S.wrap}>
      {ship ? (
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block', cursor: drag.current ? 'grabbing' : 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
        />
      ) : (
        <div style={S.empty}>No ship position. Box a “Ship Pos” region, or turn on Debug values.</div>
      )}
      <button style={S.fitBtn} onClick={fit}>
        Fit
      </button>
      {hoverInfo && (
        <div style={{ ...S.tip, left: hover!.x + 12, top: hover!.y + 12 }}>
          <div style={S.tipTitle}>
            {hoverInfo.e.ore ?? '—'} <span style={S.tipNodes}>×{hoverInfo.e.nodes ?? '?'}</span>
          </div>
          <div style={S.tipRow}>RS {hoverInfo.e.rs}</div>
          <div style={S.tipRow}>
            {km(hoverInfo.dist)} km away · depth {km(hoverInfo.depth)} km
          </div>
          <div style={S.tipDim}>{hoverInfo.e.scout}</div>
        </div>
      )}
    </div>
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: View,
  entries: SurveyEntry[],
  ship: Vec3 | null,
  plane: AxisPlane,
  hoverId: string | null,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(0, 0, w, h);
  if (!ship) return;

  const cx = w / 2;
  const cy = h / 2;
  const sx = cx + view.panX;
  const sy = cy + view.panY;

  const stepM = niceStep(80 / view.ppm); // ~80px target spacing
  const stepPx = stepM * view.ppm;

  // Faint square grid.
  ctx.strokeStyle = 'rgba(120,140,160,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = sx % stepPx; x < w; x += stepPx) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, h);
  }
  for (let y = sy % stepPx; y < h; y += stepPx) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(w, Math.round(y) + 0.5);
  }
  ctx.stroke();

  // Concentric range rings + km labels.
  const maxRingPx = Math.hypot(Math.max(sx, w - sx), Math.max(sy, h - sy));
  ctx.strokeStyle = 'rgba(120,140,160,0.18)';
  ctx.fillStyle = 'rgba(159,179,200,0.6)';
  ctx.font = '10px ui-monospace, monospace';
  for (let k = 1; k * stepPx < maxRingPx; k++) {
    const r = k * stepPx;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(`${km(k * stepM)} km`, sx + r + 3, sy - 2);
  }

  // Axes through the ship.
  ctx.strokeStyle = 'rgba(120,140,160,0.3)';
  ctx.beginPath();
  ctx.moveTo(0, Math.round(sy) + 0.5);
  ctx.lineTo(w, Math.round(sy) + 0.5);
  ctx.moveTo(Math.round(sx) + 0.5, 0);
  ctx.lineTo(Math.round(sx) + 0.5, h);
  ctx.stroke();

  // Entries.
  for (const e of entries) {
    const p = project(e.pos, ship, plane);
    const x = sx + p.x * view.ppm;
    const y = sy - p.y * view.ppm;
    if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
    const hovered = e.id === hoverId;
    const hue = oreHue(e.ore ?? 'ore');
    ctx.beginPath();
    ctx.arc(x, y, hovered ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${hue} 70% 60%)`;
    ctx.fill();
    if (hovered) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Ship marker (cyan plus).
  ctx.strokeStyle = '#4fd1ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx - 8, sy);
  ctx.lineTo(sx + 8, sy);
  ctx.moveTo(sx, sy - 8);
  ctx.lineTo(sx, sy + 8);
  ctx.stroke();
}

const S: Record<string, CSSProperties> = {
  wrap: { position: 'relative', width: '100%', height: '100%', background: '#0a0c10', borderRadius: 8, overflow: 'hidden' },
  empty: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, color: '#9fb3c8', fontSize: 13 },
  fitBtn: { position: 'absolute', right: 8, bottom: 8, background: '#1d2128cc', color: '#e6e6e6', border: '1px solid #3a4150', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  tip: { position: 'absolute', pointerEvents: 'none', background: 'rgba(13,15,18,0.95)', border: '1px solid #3a4150', borderRadius: 6, padding: '6px 8px', fontSize: 12, color: '#e6e6e6', maxWidth: 220, zIndex: 2 },
  tipTitle: { fontWeight: 700 },
  tipNodes: { color: '#4fd1ff' },
  tipRow: { fontSize: 11, opacity: 0.85, fontVariantNumeric: 'tabular-nums' },
  tipDim: { fontSize: 11, opacity: 0.5 },
};

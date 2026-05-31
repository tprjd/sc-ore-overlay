// 2D top-down survey map. Centers on the logged field itself (the centroid of
// the displayed entries) so their mutual distances read correctly regardless of
// where the live ship currently is; the ship is drawn as a marker. Falls back to
// the ship as the origin when there are no entries yet. Faint grid + concentric
// range rings (km), pan by drag, cursor-anchored wheel zoom, hover tooltip.

import { useEffect, useMemo, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

import { distance, project } from '../../core';
import type { AxisPlane, SurveyEntry, Vec3 } from '../../core';

export interface SurveyMapProps {
  /** Live ship position (drawn as a marker); may be null when not flying. */
  ship: Vec3 | null;
  entries: SurveyEntry[];
  plane?: AxisPlane;
}

interface View {
  ppm: number;
  panX: number;
  panY: number;
}

interface Hover {
  x: number;
  y: number;
  entry: SurveyEntry;
}

const km = (m: number): string => (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });

/** Per-axis median — a center robust to a stray garbage coordinate. */
function medianVec(entries: SurveyEntry[]): Vec3 {
  const med = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return {
    x: med(entries.map((e) => e.pos.x)),
    y: med(entries.map((e) => e.pos.y)),
    z: med(entries.map((e) => e.pos.z)),
  };
}

/** Implausible distance between two same-system points (≈ 100,000 km). */
const FAR = 1e8;

function oreHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const f = rough / pow;
  const n = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return n * pow;
}

export function SurveyMap({ ship, entries, plane = 'xy' }: SurveyMapProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ ppm: 0.02, panX: 0, panY: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const sizeRef = useRef(size);
  sizeRef.current = size;

  // Map origin: the field's own median (robust to a stray bad coordinate), or
  // the ship when there's nothing logged yet.
  const origin = useMemo<Vec3 | null>(
    () => (entries.length ? medianVec(entries) : ship),
    [entries, ship],
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => setSize({ w: wrap.clientWidth, h: wrap.clientHeight }));
    ro.observe(wrap);
    setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit to the entries' extent around the origin (ignore a far-away ship so it
  // can't blow up the scale).
  const originKey = origin ? `${origin.x},${origin.y},${origin.z}` : 'none';
  useLayoutEffect(() => {
    if (!origin || size.w < 2 || size.h < 2) return;
    // Fit to the cluster, not the farthest point: use the 90th-percentile radius
    // so one stray coordinate can't shrink everything to a dot.
    const radii = entries
      .map((e) => {
        const p = project(e.pos, origin, plane);
        return Math.hypot(p.x, p.y);
      })
      .sort((a, b) => a - b);
    let span = 10_000; // ~10 km default when empty/single
    if (radii.length) {
      const idx = Math.min(radii.length - 1, Math.floor(radii.length * 0.9));
      span = Math.max(radii[idx], 1_000) * 1.2;
    }
    const ppm = (Math.min(size.w, size.h) * 0.42) / span;
    setView({ ppm, panX: 0, panY: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, entries, plane, size.w, size.h, fitNonce]);

  // Draw.
  useEffect(() => {
    if (!canvasEl || size.w < 2 || size.h < 2) return;
    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.round(size.w * dpr);
    canvasEl.height = Math.round(size.h * dpr);
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, size.w, size.h, view, entries, origin, ship, plane, hover?.entry.id ?? null);
  }, [canvasEl, size, view, entries, origin, ship, plane, hover]);

  // Cursor-anchored wheel zoom, bound to the canvas element so it (re)binds when
  // the canvas mounts. Reads size via a ref and view via the functional update.
  useEffect(() => {
    if (!canvasEl) return;
    const handler = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = canvasEl.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cx = sizeRef.current.w / 2;
      const cy = sizeRef.current.h / 2;
      setView((v) => {
        const sx = cx + v.panX;
        const sy = cy + v.panY;
        const wx = (mx - sx) / v.ppm;
        const wy = (sy - my) / v.ppm;
        const ppm = Math.min(5, Math.max(1e-5, v.ppm * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        return { ppm, panX: mx - cx - wx * ppm, panY: my - cy + wy * ppm };
      });
    };
    canvasEl.addEventListener('wheel', handler, { passive: false });
    return () => canvasEl.removeEventListener('wheel', handler);
  }, [canvasEl]);

  const originScreen = (): { ox: number; oy: number } => ({
    ox: size.w / 2 + view.panX,
    oy: size.h / 2 + view.panY,
  });

  const hitTest = (mx: number, my: number): Hover | null => {
    if (!origin) return null;
    const { ox, oy } = originScreen();
    let best: Hover | null = null;
    let bestD = 10;
    for (const e of entries) {
      const p = project(e.pos, origin, plane);
      const x = ox + p.x * view.ppm;
      const y = oy - p.y * view.ppm;
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

  const fit = (): void => setFitNonce((n) => n + 1);

  const hoverInfo = hover
    ? (() => {
        const e = hover.entry;
        // Measure from the ship only when it's a plausible same-area position;
        // otherwise from the field center (so a garbage live read can't show
        // "99,999,993 km away").
        const shipOk = ship != null && origin != null && distance(ship, origin) < FAR;
        const ref = shipOk ? ship! : origin!;
        return { e, fromShip: shipOk, depth: project(e.pos, ref, plane).depth, dist: distance(e.pos, ref) };
      })()
    : null;

  return (
    <div ref={wrapRef} style={S.wrap}>
      {origin ? (
        <canvas
          ref={setCanvasEl}
          style={{ width: '100%', height: '100%', display: 'block', cursor: drag.current ? 'grabbing' : 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
        />
      ) : (
        <div style={S.empty}>No data yet. Log a scan, box a “Ship Pos” region, or turn on Debug values.</div>
      )}
      <button style={S.fitBtn} onClick={fit}>
        Fit
      </button>
      {hoverInfo && (
        <div style={{ ...S.tip, left: hover!.x + 12, top: hover!.y + 12 }}>
          <div style={S.tipTitle}>
            {hoverInfo.e.ore ?? '—'} <span style={S.tipNodes}>×{hoverInfo.e.nodes ?? '?'}</span>
          </div>
          <div style={S.tipRow}>
            RS {hoverInfo.e.rs}
            {hoverInfo.e.scan?.scu != null ? ` · ${hoverInfo.e.scan.scu.toFixed(1)} SCU` : ''}
          </div>
          <div style={S.tipRow}>
            {km(hoverInfo.dist)} km {hoverInfo.fromShip ? 'from ship' : 'from center'} · depth{' '}
            {km(hoverInfo.depth)} km
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
  origin: Vec3 | null,
  ship: Vec3 | null,
  plane: AxisPlane,
  hoverId: string | null,
): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(0, 0, w, h);
  if (!origin) return;

  const ox = w / 2 + view.panX;
  const oy = h / 2 + view.panY;

  const stepM = niceStep(80 / view.ppm);
  const stepPx = stepM * view.ppm;

  if (Number.isFinite(stepPx) && stepPx > 0.5) {
    ctx.strokeStyle = 'rgba(120,140,160,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox % stepPx; x < w; x += stepPx) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, h);
    }
    for (let y = oy % stepPx; y < h; y += stepPx) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(w, Math.round(y) + 0.5);
    }
    ctx.stroke();

    const maxRingPx = Math.hypot(Math.max(ox, w - ox), Math.max(oy, h - oy));
    ctx.strokeStyle = 'rgba(120,140,160,0.18)';
    ctx.fillStyle = 'rgba(159,179,200,0.6)';
    ctx.font = '10px ui-monospace, monospace';
    for (let k = 1; k * stepPx < maxRingPx; k++) {
      const r = k * stepPx;
      ctx.beginPath();
      ctx.arc(ox, oy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${km(k * stepM)} km`, ox + r + 3, oy - 2);
    }
  }

  // Axes through the origin.
  ctx.strokeStyle = 'rgba(120,140,160,0.3)';
  ctx.beginPath();
  ctx.moveTo(0, Math.round(oy) + 0.5);
  ctx.lineTo(w, Math.round(oy) + 0.5);
  ctx.moveTo(Math.round(ox) + 0.5, 0);
  ctx.lineTo(Math.round(ox) + 0.5, h);
  ctx.stroke();

  // Entries.
  for (const e of entries) {
    const p = project(e.pos, origin, plane);
    const x = ox + p.x * view.ppm;
    const y = oy - p.y * view.ppm;
    if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
    const hovered = e.id === hoverId;
    ctx.beginPath();
    ctx.arc(x, y, hovered ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${oreHue(e.ore ?? 'ore')} 70% 60%)`;
    ctx.fill();
    if (hovered) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Ship marker (cyan plus), at its offset from the origin — clamped to the
  // edge with a ring when off-screen. Hidden when the ship reads implausibly far
  // (a garbage live coordinate), so it isn't a misleading dot.
  if (ship && distance(ship, origin) < FAR) {
    const sp = project(ship, origin, plane);
    let sx = ox + sp.x * view.ppm;
    let sy = oy - sp.y * view.ppm;
    const off = sx < 6 || sx > w - 6 || sy < 6 || sy > h - 6;
    sx = Math.max(6, Math.min(w - 6, sx));
    sy = Math.max(6, Math.min(h - 6, sy));
    ctx.strokeStyle = '#4fd1ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - 8, sy);
    ctx.lineTo(sx + 8, sy);
    ctx.moveTo(sx, sy - 8);
    ctx.lineTo(sx, sy + 8);
    ctx.stroke();
    if (off) {
      ctx.beginPath();
      ctx.arc(sx, sy, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
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

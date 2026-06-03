// Reusable capture preview: shows the live source (or a still image), supports
// cursor-anchored wheel zoom + scroll, and lets the user drag a normalized 0..1
// box. Renders any number of region overlays (Survey Mode draws several, each
// role-colored); `onDraw` reports a freshly dragged box to the parent, which
// decides which region it updates. The parent owns `mediaRef` so its capture
// loop can read the same element this component attaches the stream to.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import type { DrawableSource, NormRegion } from '../preprocess';
import type { PickedSource } from './SourcePicker';

/** A region overlay to draw on the preview. */
export interface PreviewRegion {
  id: string;
  rect: NormRegion;
  /** Outline color (hex). */
  color: string;
  /** Emphasized (currently being edited). */
  active?: boolean;
  /** Optional corner label, e.g. the role. */
  label?: string;
}

export interface CapturePreviewProps {
  source: PickedSource;
  mediaRef: MutableRefObject<DrawableSource | null>;
  regions: PreviewRegion[];
  /** Called on pointer-up with a valid (non-tiny) dragged box. */
  onDraw: (rect: NormRegion) => void;
  hint?: ReactNode;
}

interface DragBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function dragToRegion(d: DragBox): NormRegion {
  return {
    x: Math.min(d.x0, d.x1),
    y: Math.min(d.y0, d.y1),
    w: Math.abs(d.x1 - d.x0),
    h: Math.abs(d.y1 - d.y0),
  };
}

export function CapturePreview({ source, mediaRef, regions, onDraw, hint }: CapturePreviewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const pendingZoom = useRef<{ ratio: number; cx: number; cy: number; contentX: number; contentY: number } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<DragBox | null>(null);

  // Attach the source to the <video> element and expose it via mediaRef. A
  // desktop capture uses srcObject (a MediaStream); a video file uses src and
  // loops, so a recorded clip gives continuous frames for debugging.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (source.kind === 'desktop' && source.stream) {
      video.srcObject = source.stream;
      mediaRef.current = video;
      void video.play().catch(() => undefined);
    } else if (source.kind === 'video' && source.videoUrl) {
      video.srcObject = null;
      video.src = source.videoUrl;
      video.loop = true;
      mediaRef.current = video;
      void video.play().catch(() => undefined);
    }
  }, [source, mediaRef]);

  // Wheel = zoom centered on the cursor; keep the point under the cursor fixed.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = area.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const contentX = area.scrollLeft + cx;
      const contentY = area.scrollTop + cy;
      setZoom((z) => {
        const nz = Math.min(6, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        pendingZoom.current = { ratio: nz / z, cx, cy, contentX, contentY };
        return nz;
      });
    };
    area.addEventListener('wheel', onWheel, { passive: false });
    return () => area.removeEventListener('wheel', onWheel);
  }, []);

  // After a wheel-zoom re-renders, adjust scroll so the cursor point holds.
  useLayoutEffect(() => {
    const p = pendingZoom.current;
    const area = areaRef.current;
    if (!p || !area) return;
    area.scrollLeft = p.contentX * p.ratio - p.cx;
    area.scrollTop = p.contentY * p.ratio - p.cy;
    pendingZoom.current = null;
  }, [zoom]);

  const toNorm = (clientX: number, clientY: number): { x: number; y: number } => {
    const media = mediaRef.current;
    if (!media) return { x: 0, y: 0 };
    const r = media.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { x: 0, y: 0 };
    return { x: clamp01((clientX - r.left) / r.width), y: clamp01((clientY - r.top) / r.height) };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toNorm(e.clientX, e.clientY);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    setDrag((d) => {
      if (!d) return d;
      const p = toNorm(e.clientX, e.clientY);
      return { ...d, x1: p.x, y1: p.y };
    });
  };
  const onPointerUp = (): void => {
    if (drag) {
      const r = dragToRegion(drag);
      if (r.w > 0.004 && r.h > 0.004) onDraw(r);
      setDrag(null);
    }
  };

  const dragRegion = drag ? dragToRegion(drag) : null;

  return (
    <div style={S.col}>
      <label style={S.zoomRow}>
        <span style={S.zoomLabel}>Zoom</span>
        <input
          type="range"
          min={100}
          max={600}
          step={10}
          value={Math.round(zoom * 100)}
          onChange={(e) => setZoom(Number(e.target.value) / 100)}
          style={S.range}
        />
        <span style={S.zoomValue}>{zoom.toFixed(1)}×</span>
      </label>
      <div ref={areaRef} style={S.area}>
        <div
          ref={wrapRef}
          style={{ ...S.wrap, width: `${zoom * 100}%` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {source.kind === 'desktop' || source.kind === 'video' ? (
            <video ref={videoRef} muted playsInline loop={source.kind === 'video'} style={S.media} />
          ) : (
            <img
              ref={imgRef}
              src={source.imageUrl}
              alt="capture source"
              style={S.media}
              onLoad={() => {
                mediaRef.current = imgRef.current;
              }}
            />
          )}
          {regions.map((r) => (
            <div
              key={r.id}
              style={{
                ...S.box,
                left: `${r.rect.x * 100}%`,
                top: `${r.rect.y * 100}%`,
                width: `${r.rect.w * 100}%`,
                height: `${r.rect.h * 100}%`,
                borderColor: r.color,
                borderStyle: r.active ? 'solid' : 'dashed',
                background: r.active ? `${r.color}22` : 'transparent',
                boxShadow: r.active ? `0 0 0 1px ${r.color}` : 'none',
              }}
            >
              {r.label && <span style={{ ...S.boxLabel, background: r.color }}>{r.label}</span>}
            </div>
          ))}
          {dragRegion && (
            <div
              style={{
                ...S.box,
                left: `${dragRegion.x * 100}%`,
                top: `${dragRegion.y * 100}%`,
                width: `${dragRegion.w * 100}%`,
                height: `${dragRegion.h * 100}%`,
                borderColor: '#fff',
                borderStyle: 'solid',
                background: 'rgba(255,255,255,0.12)',
              }}
            />
          )}
        </div>
      </div>
      {hint && <p style={S.hint}>{hint}</p>}
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  col: { flex: 1, display: 'flex', flexDirection: 'column', padding: 14, minWidth: 0 },
  zoomRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  zoomLabel: { width: 40, fontSize: 12, opacity: 0.8 },
  zoomValue: { width: 48, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' },
  range: { flex: 1 },
  area: { flex: 1, minHeight: 0, overflow: 'auto', background: '#000', borderRadius: 8 },
  wrap: {
    position: 'relative',
    display: 'inline-block',
    verticalAlign: 'top',
    lineHeight: 0,
    touchAction: 'none',
    cursor: 'crosshair',
  },
  media: { display: 'block', width: '100%', height: 'auto', userSelect: 'none', pointerEvents: 'none' },
  box: { position: 'absolute', borderWidth: 2, pointerEvents: 'none' },
  boxLabel: {
    position: 'absolute',
    top: -16,
    left: -1,
    fontSize: 9,
    lineHeight: '14px',
    padding: '0 4px',
    color: '#06121a',
    fontWeight: 700,
    borderRadius: 3,
    whiteSpace: 'nowrap',
  },
  hint: { margin: '10px 2px 0', fontSize: 12, opacity: 0.6 },
};

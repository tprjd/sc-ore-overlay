// Step 2: calibrate the RS region and watch the live read. Drag a box over the
// scanner number (stored as normalized 0..1 coords); the crop is read with
// PP-OCR, validated, then matched to ore(s) shown as "Ore ×N". The location
// dropdown narrows overlapping-signature matches.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { useCaptureLoop } from '../useCaptureLoop';
import type { LoopParams } from '../useCaptureLoop';
import type { DrawableSource, NormRegion } from '../preprocess';
import type { PickedSource } from './SourcePicker';
import { matchOre, groupLocations } from '../../core';
import type { SignatureTable } from '../../core';

export interface ScanViewProps {
  source: PickedSource;
  region: NormRegion | null;
  onRegionChange: (r: NormRegion | null) => void;
  params: LoopParams;
  onParamsChange: (p: LoopParams) => void;
  table: SignatureTable;
  location: string | null;
  onLocationChange: (location: string | null) => void;
  onBack: () => void;
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

export function ScanView({
  source,
  region,
  onRegionChange,
  params,
  onParamsChange,
  table,
  location,
  onLocationChange,
  onBack,
}: ScanViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const mediaRef = useRef<DrawableSource | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [paused, setPaused] = useState(false);
  const [drag, setDrag] = useState<DragBox | null>(null);

  // Attach the live stream to the <video> element.
  useEffect(() => {
    if (source.kind === 'desktop' && source.stream && videoRef.current) {
      const video = videoRef.current;
      video.srcObject = source.stream;
      mediaRef.current = video;
      void video.play().catch(() => undefined);
    }
  }, [source]);

  const loop = useCaptureLoop(mediaRef, region, params, !paused);

  // Phase 2: feed the accepted reading into the matcher (method "Ship" + the
  // selected location). Overlapping signatures surface as multiple candidates.
  const systemGroups = useMemo(() => groupLocations(table), [table]);
  const matches = useMemo(
    () =>
      loop.stable != null
        ? matchOre(loop.stable, table, { method: 'Ship' }, { location })
        : [],
    [loop.stable, table, location],
  );

  // ---- region drag (normalized to the displayed media box) ----
  const toNorm = (clientX: number, clientY: number): { x: number; y: number } => {
    const el = wrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
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
      if (r.w > 0.004 && r.h > 0.004) onRegionChange(r);
      setDrag(null);
    }
  };

  const shownRegion = drag ? dragToRegion(drag) : region;
  const set = <K extends keyof LoopParams>(key: K, val: LoopParams[K]): void =>
    onParamsChange({ ...params, [key]: val });

  return (
    <div style={S.page}>
      <header style={S.header}>
        <button style={S.btn} onClick={onBack}>← Sources</button>
        <span style={S.srcLabel}>
          <span style={S.badge}>{source.kind}</span>
          {source.label}
        </span>
        <span style={S.spacer} />
        <button style={S.btn} onClick={() => setPaused((p) => !p)}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button style={S.btn} onClick={() => onRegionChange(null)} disabled={!region}>
          Clear region
        </button>
      </header>

      <div style={S.body}>
        {/* Preview + region overlay */}
        <div style={S.previewCol}>
          <div
            ref={wrapRef}
            style={S.preview}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {source.kind === 'desktop' ? (
              <video ref={videoRef} muted playsInline style={S.media} />
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
            {shownRegion && (
              <div
                style={{
                  ...S.regionBox,
                  left: `${shownRegion.x * 100}%`,
                  top: `${shownRegion.y * 100}%`,
                  width: `${shownRegion.w * 100}%`,
                  height: `${shownRegion.h * 100}%`,
                }}
              />
            )}
          </div>
          <p style={S.hint}>
            {region
              ? 'Drag again to re-draw the region over the RS number.'
              : 'Drag a box over the Radar Signature number to start.'}
          </p>
        </div>

        {/* Tuning + debug */}
        <div style={S.panel}>
          <div style={S.readout}>
            <div style={S.readoutLabel}>Accepted reading</div>
            <div style={S.readoutValue}>{loop.stable ?? '—'}</div>
            <div style={S.readoutMeta}>
              {paused ? 'paused' : `every ${params.intervalMs} ms · quorum ${params.quorum} · OCR ×${loop.ocrRuns}`}
            </div>
          </div>

          <Section title="Match">
            <label style={S.selectRow}>
              <span style={S.sliderLabel}>Location</span>
              <select
                style={S.select}
                value={location ?? ''}
                onChange={(e) => onLocationChange(e.target.value || null)}
              >
                <option value="">Anywhere</option>
                {systemGroups.map((g) => (
                  <optgroup key={g.system} label={g.system}>
                    {g.locations.map((loc) => (
                      <option key={`${g.system}:${loc}`} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {loop.stable == null ? (
              <p style={S.dim}>Waiting for a stable reading…</p>
            ) : matches.length === 0 ? (
              <p style={S.dim}>
                No ore matches {loop.stable}
                {location ? ` at ${location}` : ''}.
              </p>
            ) : (
              <ul style={S.candList}>
                {matches.map((c) => (
                  <li key={c.name} style={S.candRow}>
                    <span style={S.candName}>{c.name}</span>
                    <span style={S.candNodes}>×{c.nodes}</span>
                    <span style={S.candScore}>{Math.round(c.score * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Debug">
            <div style={S.debugRow}>
              <div style={S.cropWrap}>
                {loop.dataUrl ? (
                  <img src={loop.dataUrl} alt="region crop" style={S.crop} />
                ) : (
                  <span style={S.dim}>no crop yet</span>
                )}
              </div>
              <dl style={S.dl}>
                <Row k="detected" v={loop.rawText || '—'} />
                <Row k="parsed" v={loop.value === null ? 'null' : String(loop.value)} />
                <Row k="plausible" v={loop.plausible ? 'yes' : 'no'} />
                <Row k="frame" v={loop.skipped ? 'unchanged (skipped)' : 'changed'} />
              </dl>
            </div>
            {loop.error && <div style={S.error}>{loop.error}</div>}
          </Section>

          <Section title="Capture">
            <Slider
              label="Upscale"
              min={1}
              max={8}
              value={params.scale}
              onChange={(v) => set('scale', v)}
              suffix="×"
            />
          </Section>

          <Section title="Timing">
            <Slider
              label="Interval"
              min={300}
              max={2000}
              step={50}
              value={params.intervalMs}
              onChange={(v) => set('intervalMs', v)}
              suffix=" ms"
            />
            <Slider
              label="Vote quorum"
              min={1}
              max={8}
              value={params.quorum}
              onChange={(v) => set('quorum', v)}
              suffix=" frames"
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={S.section}>
      <h2 style={S.h2}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={S.row}>
      <dt style={S.dt}>{k}</dt>
      <dd style={S.dd}>{v}</dd>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  suffix = '',
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label style={S.sliderRow}>
      <span style={S.sliderLabel}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={S.range}
      />
      <span style={S.sliderValue}>
        {value}
        {suffix}
      </span>
    </label>
  );
}

const S: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100vh', color: '#e6e6e6', boxSizing: 'border-box' },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #2c323d' },
  srcLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, opacity: 0.9 },
  spacer: { flex: 1 },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  previewCol: { flex: 1, display: 'flex', flexDirection: 'column', padding: 14, minWidth: 0 },
  preview: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#000',
    borderRadius: 8,
    overflow: 'hidden',
    touchAction: 'none',
    cursor: 'crosshair',
  },
  media: { maxWidth: '100%', maxHeight: '100%', display: 'block', userSelect: 'none', pointerEvents: 'none' },
  regionBox: { position: 'absolute', border: '2px solid #4fd1ff', background: 'rgba(79,209,255,0.12)', pointerEvents: 'none' },
  hint: { margin: '10px 2px 0', fontSize: 12, opacity: 0.6 },
  panel: { width: 360, borderLeft: '1px solid #2c323d', padding: 14, overflowY: 'auto', boxSizing: 'border-box' },
  readout: { background: '#1d2128', border: '1px solid #2c323d', borderRadius: 8, padding: 12, marginBottom: 14, textAlign: 'center' },
  readoutLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 },
  readoutValue: { fontSize: 40, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color: '#4fd1ff' },
  readoutMeta: { fontSize: 11, opacity: 0.55 },
  section: { marginBottom: 16 },
  h2: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6, margin: '0 0 8px' },
  debugRow: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  cropWrap: {
    minWidth: 120,
    minHeight: 48,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0d0f12',
    border: '1px solid #2c323d',
    borderRadius: 4,
    padding: 4,
  },
  crop: { maxWidth: 160, imageRendering: 'pixelated' },
  dl: { margin: 0, flex: 1, fontSize: 12 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' },
  dt: { opacity: 0.6 },
  dd: { margin: 0, fontFamily: 'ui-monospace, monospace', textAlign: 'right', wordBreak: 'break-all' },
  dim: { opacity: 0.4, fontSize: 12 },
  sliderRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  sliderLabel: { width: 82, fontSize: 12, opacity: 0.8 },
  range: { flex: 1 },
  sliderValue: { width: 56, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' },
  checkRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.9 },
  btn: { background: '#2a2f3a', color: '#e6e6e6', border: '1px solid #3a4150', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 13 },
  badge: { fontSize: 10, textTransform: 'uppercase', background: '#2c323d', borderRadius: 4, padding: '2px 5px', opacity: 0.8 },
  error: { marginTop: 8, background: '#3a1f24', border: '1px solid #7a3b44', color: '#ffb4bd', padding: '6px 10px', borderRadius: 6, fontSize: 12 },
  selectRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  select: { flex: 1, background: '#0d0f12', color: '#e6e6e6', border: '1px solid #3a4150', borderRadius: 6, padding: '6px 8px', fontSize: 13 },
  candList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  candRow: { display: 'flex', alignItems: 'baseline', gap: 8, background: '#1d2128', border: '1px solid #2c323d', borderRadius: 6, padding: '8px 10px' },
  candName: { flex: 1, fontSize: 16, fontWeight: 600 },
  candNodes: { fontSize: 16, color: '#4fd1ff', fontVariantNumeric: 'tabular-nums' },
  candScore: { fontSize: 11, opacity: 0.5, width: 40, textAlign: 'right' },
};

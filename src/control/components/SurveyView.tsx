// Survey tab: draw several capture regions, assign each a role (RS number, ship
// position, system name), and watch them read live. Phase S1 focuses on getting
// the debug-overlay coordinate read working and verified; logging + the map come
// in S2/S3. Reuses the shared CapturePreview and the existing OCR pipeline.

import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { CapturePreview } from './CapturePreview';
import type { PreviewRegion } from './CapturePreview';
import type { PickedSource } from './SourcePicker';
import { useSurveyCapture } from '../useSurveyCapture';
import type { ActiveSurveyRegion } from '../useSurveyCapture';
import type { LoopParams } from '../useCaptureLoop';
import type { DrawableSource, NormRegion } from '../preprocess';
import type { SignatureTable } from '../../core';
import type { SurveyRegionSetting, SurveyRole } from '../../shared/bridge';

export interface SurveyViewProps {
  source: PickedSource;
  table: SignatureTable;
  params: LoopParams;
  regions: SurveyRegionSetting[];
  onRegionsChange: (regions: SurveyRegionSetting[]) => void;
  onBack: () => void;
}

const ROLE_META: Record<SurveyRole, { label: string; color: string }> = {
  shipPos: { label: 'Ship Pos', color: '#6ee7b7' },
  rs: { label: 'RS', color: '#4fd1ff' },
  system: { label: 'System', color: '#fbbf24' },
};

const DEFAULT_RECT: NormRegion = { x: 0.4, y: 0.45, w: 0.2, h: 0.06 };

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const km = (m: number): string => (m / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function SurveyView({ source, table, params, regions, onRegionsChange, onBack }: SurveyViewProps) {
  const mediaRef = useRef<DrawableSource | null>(null);
  const [activeId, setActiveId] = useState<string | null>(regions[0]?.id ?? null);

  const active: ActiveSurveyRegion[] = useMemo(
    () => regions.filter((r) => r.enabled).map((r) => ({ id: r.id, role: r.role, rect: r.rect })),
    [regions],
  );
  const readout = useSurveyCapture(mediaRef, active, params, true, table);

  const previewRegions: PreviewRegion[] = regions.map((r) => ({
    id: r.id,
    rect: r.rect,
    color: ROLE_META[r.role].color,
    active: r.id === activeId,
    label: ROLE_META[r.role].label,
  }));

  const addRegion = (role: SurveyRole): void => {
    const id = newId();
    onRegionsChange([...regions, { id, role, rect: DEFAULT_RECT, enabled: true }]);
    setActiveId(id);
  };
  const updateRegion = (id: string, patch: Partial<SurveyRegionSetting>): void =>
    onRegionsChange(regions.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRegion = (id: string): void => {
    onRegionsChange(regions.filter((r) => r.id !== id));
    if (activeId === id) setActiveId(null);
  };
  const onDraw = (rect: NormRegion): void => {
    if (activeId) updateRegion(activeId, { rect });
  };

  return (
    <div style={S.page}>
      <header style={S.header}>
        <button style={S.btn} onClick={onBack}>← Sources</button>
        <span style={S.srcLabel}>
          <span style={S.badge}>{source.kind}</span>
          {source.label}
        </span>
        <span style={S.spacer} />
        <span style={S.dim}>Survey · scout &amp; map (S1: coordinate read)</span>
      </header>

      <div style={S.body}>
        <CapturePreview
          source={source}
          mediaRef={mediaRef}
          regions={previewRegions}
          onDraw={onDraw}
          hint={
            activeId
              ? 'Drag a box over the selected field. Zoom + scroll to refine.'
              : 'Add a region below, then drag a box over the value on the HUD.'
          }
        />

        <div style={S.panel}>
          <Card title="Live readout">
            <div style={S.kv}>
              <span style={S.k}>System</span>
              <span style={S.v}>{readout.system ?? '—'}</span>
            </div>
            <div style={S.coordBlock}>
              <div style={S.coordTitle}>
                Ship position {readout.posZone ? <span style={S.dim}>· {readout.posZone}</span> : null}
              </div>
              {readout.pos ? (
                <div style={S.coordGrid}>
                  <span style={S.axis}>X</span>
                  <span style={S.coord}>{km(readout.pos.x)} km</span>
                  <span style={S.axis}>Y</span>
                  <span style={S.coord}>{km(readout.pos.y)} km</span>
                  <span style={S.axis}>Z</span>
                  <span style={S.coord}>{km(readout.pos.z)} km</span>
                </div>
              ) : (
                <div style={S.dim}>no coordinates yet</div>
              )}
            </div>
            <div style={S.kv}>
              <span style={S.k}>RS</span>
              <span style={S.v}>{readout.rs ?? '—'}</span>
            </div>
            {readout.candidates.length > 0 && (
              <ul style={S.candList}>
                {readout.candidates.map((c) => (
                  <li key={c.name} style={S.candRow}>
                    <span style={S.candName}>{c.name}</span>
                    <span style={S.candNodes}>×{c.nodes}</span>
                    <span style={S.candScore}>{Math.round(c.score * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
            {readout.error && <div style={S.error}>{readout.error}</div>}
          </Card>

          <Card title="Regions">
            <div style={S.addRow}>
              <span style={S.dim}>Add:</span>
              {(Object.keys(ROLE_META) as SurveyRole[]).map((role) => (
                <button key={role} style={S.addBtn} onClick={() => addRegion(role)}>
                  + {ROLE_META[role].label}
                </button>
              ))}
            </div>
            {regions.length === 0 ? (
              <p style={S.dim}>No regions yet. Add one to start reading the HUD.</p>
            ) : (
              <div style={S.regionList}>
                {regions.map((r) => {
                  const dbg = readout.regions[r.id];
                  return (
                    <div
                      key={r.id}
                      style={{ ...S.regionCard, ...(r.id === activeId ? S.regionCardActive : null) }}
                      onClick={() => setActiveId(r.id)}
                    >
                      <div style={S.regionTop}>
                        <span style={{ ...S.dot, background: ROLE_META[r.role].color }} />
                        <select
                          style={S.select}
                          value={r.role}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateRegion(r.id, { role: e.target.value as SurveyRole })}
                        >
                          {(Object.keys(ROLE_META) as SurveyRole[]).map((role) => (
                            <option key={role} value={role}>
                              {ROLE_META[role].label}
                            </option>
                          ))}
                        </select>
                        <label style={S.enableLabel} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={r.enabled}
                            onChange={(e) => updateRegion(r.id, { enabled: e.target.checked })}
                          />
                          on
                        </label>
                        <button
                          style={S.delBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRegion(r.id);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                      <div style={S.regionBody}>
                        <div style={S.cropWrap}>
                          {dbg?.dataUrl ? (
                            <img src={dbg.dataUrl} alt="crop" style={S.crop} />
                          ) : (
                            <span style={S.dim}>{r.enabled ? '…' : 'off'}</span>
                          )}
                        </div>
                        <div style={S.regionMeta}>
                          <div style={{ ...S.parsed, color: dbg?.ok ? '#6ee7b7' : '#9fb3c8' }}>
                            {dbg?.parsed ?? '—'}
                          </div>
                          <div style={S.raw}>{dbg?.rawText ?? '(waiting)'}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p style={S.dim}>
              Enable SC&apos;s debug overlay (the <code>Zone … Pos</code> readout) and box the{' '}
              <b>SolarSystem</b> line for absolute coordinates.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={S.card}>
      <h2 style={S.cardTitle}>{title}</h2>
      {children}
    </section>
  );
}

const S: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', color: '#e6e6e6', boxSizing: 'border-box' },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #2c323d' },
  srcLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, opacity: 0.9 },
  spacer: { flex: 1 },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  panel: { width: 380, borderLeft: '1px solid #2c323d', padding: 14, overflowY: 'auto', boxSizing: 'border-box' },
  card: { background: '#1d2128', border: '1px solid #2c323d', borderRadius: 8, padding: 12, marginBottom: 14 },
  cardTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6, margin: '0 0 10px' },
  kv: { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' },
  k: { opacity: 0.6, fontSize: 13 },
  v: { fontFamily: 'ui-monospace, monospace', fontSize: 14 },
  coordBlock: { margin: '8px 0', padding: '8px 10px', background: '#0d0f12', border: '1px solid #2c323d', borderRadius: 6 },
  coordTitle: { fontSize: 11, opacity: 0.6, marginBottom: 6 },
  coordGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', alignItems: 'baseline' },
  axis: { fontSize: 11, opacity: 0.5 },
  coord: { fontFamily: 'ui-monospace, monospace', fontSize: 14, color: '#6ee7b7', textAlign: 'right' },
  dim: { opacity: 0.45, fontSize: 12 },
  candList: { listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  candRow: { display: 'flex', alignItems: 'baseline', gap: 8, background: '#0d0f12', border: '1px solid #2c323d', borderRadius: 6, padding: '6px 8px' },
  candName: { flex: 1, fontSize: 14, fontWeight: 600 },
  candNodes: { fontSize: 14, color: '#4fd1ff', fontVariantNumeric: 'tabular-nums' },
  candScore: { fontSize: 11, opacity: 0.5, width: 40, textAlign: 'right' },
  addRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  addBtn: { background: '#2a2f3a', color: '#e6e6e6', border: '1px solid #3a4150', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 },
  regionList: { display: 'flex', flexDirection: 'column', gap: 8 },
  regionCard: { background: '#0d0f12', border: '1px solid #2c323d', borderRadius: 6, padding: 8, cursor: 'pointer' },
  regionCardActive: { borderColor: '#4fd1ff' },
  regionTop: { display: 'flex', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, flex: '0 0 auto' },
  select: { flex: 1, background: '#0d0f12', color: '#e6e6e6', border: '1px solid #3a4150', borderRadius: 6, padding: '4px 6px', fontSize: 13 },
  enableLabel: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, opacity: 0.8 },
  delBtn: { background: 'none', color: '#9fb3c8', border: '1px solid #3a4150', borderRadius: 6, padding: '2px 7px', cursor: 'pointer', fontSize: 12 },
  regionBody: { display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-start' },
  cropWrap: { minWidth: 96, minHeight: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', border: '1px solid #2c323d', borderRadius: 4, padding: 2 },
  crop: { maxWidth: 140, maxHeight: 60, imageRendering: 'pixelated' },
  regionMeta: { flex: 1, minWidth: 0 },
  parsed: { fontFamily: 'ui-monospace, monospace', fontSize: 13, wordBreak: 'break-all' },
  raw: { fontSize: 11, opacity: 0.5, marginTop: 2, wordBreak: 'break-all' },
  btn: { background: '#2a2f3a', color: '#e6e6e6', border: '1px solid #3a4150', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 13 },
  badge: { fontSize: 10, textTransform: 'uppercase', background: '#2c323d', borderRadius: 4, padding: '2px 5px', opacity: 0.8 },
  error: { marginTop: 8, background: '#3a1f24', border: '1px solid #7a3b44', color: '#ffb4bd', padding: '6px 10px', borderRadius: 6, fontSize: 12 },
};

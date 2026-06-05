// Shared capture-region picker UI: add/select/role/enable/upscale/delete rows
// with a per-region OCR debug crop. Used by both the Survey and Mining tabs; the
// allowed roles are passed in. Renders inner content only — the caller wraps it
// in a section/card. Drawing the box happens in CapturePreview (the caller wires
// the active region's rect).

import type { CSSProperties, ReactNode } from 'react';
import type { SurveyRegionSetting, SurveyRole } from '../../shared/bridge';
import type { RegionDebug } from '../useSurveyCapture';
import { DEFAULT_RECT, newRegionId, ROLE_META } from './roles';

// Calibration verdict for a region: grey = not ready, red = read text but
// didn't parse/match (or low confidence), amber = parsed but borderline, green
// = parsed with high OCR confidence. PP-OCR runs high, so the bands are tight.
// Tints the crop border + the confidence chip so a region is tunable at a glance.
function verdictColor(dbg?: RegionDebug): string {
  if (!dbg || dbg.score == null) return '#9fb3c8';
  if (!dbg.ok) return '#f87171';
  if (dbg.score >= 0.9) return '#6ee7b7';
  if (dbg.score >= 0.7) return '#fbbf24';
  return '#f87171';
}

export interface RegionListProps {
  regions: SurveyRegionSetting[];
  onRegionsChange: (regions: SurveyRegionSetting[]) => void;
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
  /** Per-region OCR debug, keyed by region id (from the capture readout). */
  debug: Record<string, RegionDebug>;
  /** Roles this picker offers (add buttons + role dropdown). */
  roles: SurveyRole[];
  /** Default upscale shown when a region has no override. */
  defaultScale: number;
  hint?: ReactNode;
}

export function RegionList({
  regions,
  onRegionsChange,
  activeId,
  onActiveChange,
  debug,
  roles,
  defaultScale,
  hint,
}: RegionListProps) {
  const addRegion = (role: SurveyRole): void => {
    const id = newRegionId();
    onRegionsChange([...regions, { id, role, rect: DEFAULT_RECT, enabled: true }]);
    onActiveChange(id);
  };
  const updateRegion = (id: string, patch: Partial<SurveyRegionSetting>): void =>
    onRegionsChange(regions.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRegion = (id: string): void => {
    onRegionsChange(regions.filter((r) => r.id !== id));
    if (activeId === id) onActiveChange(null);
  };

  return (
    <>
      <div style={S.addRow}>
        <span style={S.dim}>Add:</span>
        {roles.map((role) => (
          <button key={role} type="button" style={S.addBtn} onClick={() => addRegion(role)}>
            + {ROLE_META[role].label}
          </button>
        ))}
      </div>
      {regions.length === 0 ? (
        <p style={S.dim}>No regions yet. Add one to start reading the HUD.</p>
      ) : (
        <div style={S.regionList}>
          {regions.map((r) => {
            const dbg = debug[r.id];
            const verdict = verdictColor(dbg);
            return (
              <div
                key={r.id}
                style={{ ...S.regionCard, ...(r.id === activeId ? S.regionCardActive : null) }}
                onClick={() => onActiveChange(r.id)}
              >
                <div style={S.regionTop}>
                  <span style={{ ...S.dot, background: ROLE_META[r.role].color }} />
                  <select
                    style={S.select}
                    value={r.role}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateRegion(r.id, { role: e.target.value as SurveyRole })}
                  >
                    {roles.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_META[role].label}
                      </option>
                    ))}
                  </select>
                  <label
                    style={S.scaleLabel}
                    title="upscale — raise for small/blurry text (high FOV)"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={r.scale ?? defaultScale}
                      onChange={(e) =>
                        updateRegion(r.id, {
                          scale: Math.max(1, Math.min(12, Math.round(Number(e.target.value)) || 1)),
                        })
                      }
                      style={S.scaleInput}
                    />
                    ×
                  </label>
                  <label style={S.enableLabel} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) => updateRegion(r.id, { enabled: e.target.checked })}
                    />
                    on
                  </label>
                  <button
                    type="button"
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
                  <div style={{ ...S.cropWrap, borderColor: verdict }}>
                    {dbg?.dataUrl ? (
                      <img src={dbg.dataUrl} alt="crop" style={S.crop} />
                    ) : (
                      <span style={S.dim}>{r.enabled ? '…' : 'off'}</span>
                    )}
                  </div>
                  <div style={S.regionMeta}>
                    <div style={S.parsedRow}>
                      <span style={{ ...S.parsed, color: dbg?.ok ? '#6ee7b7' : '#9fb3c8' }}>
                        {dbg?.parsed ?? '—'}
                      </span>
                      {dbg?.score != null && (
                        <span style={{ ...S.conf, color: verdict, borderColor: verdict }}>
                          {Math.round(dbg.score * 100)}%
                        </span>
                      )}
                    </div>
                    <div style={S.raw}>{dbg?.rawText ?? '(waiting)'}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {hint && <p style={S.dim}>{hint}</p>}
    </>
  );
}

const S: Record<string, CSSProperties> = {
  dim: { opacity: 0.45, fontSize: 12 },
  addRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  addBtn: {
    background: '#2a2f3a',
    color: '#e6e6e6',
    border: '1px solid #3a4150',
    borderRadius: 6,
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: 12,
  },
  regionList: { display: 'flex', flexDirection: 'column', gap: 8 },
  regionCard: {
    background: '#0d0f12',
    border: '1px solid #2c323d',
    borderRadius: 6,
    padding: 8,
    cursor: 'pointer',
  },
  regionCardActive: { borderColor: '#4fd1ff' },
  regionTop: { display: 'flex', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, flex: '0 0 auto' },
  select: {
    flex: 1,
    background: '#0d0f12',
    color: '#e6e6e6',
    border: '1px solid #3a4150',
    borderRadius: 6,
    padding: '4px 6px',
    fontSize: 13,
  },
  scaleLabel: { display: 'flex', alignItems: 'center', gap: 2, fontSize: 11, opacity: 0.7 },
  scaleInput: {
    width: 36,
    background: '#0d0f12',
    color: '#e6e6e6',
    border: '1px solid #3a4150',
    borderRadius: 4,
    padding: '2px 4px',
    fontSize: 12,
  },
  enableLabel: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, opacity: 0.8 },
  delBtn: {
    background: 'none',
    color: '#9fb3c8',
    border: '1px solid #3a4150',
    borderRadius: 6,
    padding: '2px 7px',
    cursor: 'pointer',
    fontSize: 12,
  },
  regionBody: { display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-start' },
  cropWrap: {
    minWidth: 96,
    minHeight: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#000',
    border: '1px solid #2c323d',
    borderRadius: 4,
    padding: 2,
  },
  crop: { maxWidth: 140, maxHeight: 60, imageRendering: 'pixelated' },
  regionMeta: { flex: 1, minWidth: 0 },
  parsedRow: { display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'space-between' },
  parsed: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: 13,
    wordBreak: 'break-all',
    minWidth: 0,
  },
  conf: {
    fontSize: 11,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    border: '1px solid',
    borderRadius: 4,
    padding: '0 5px',
    flex: '0 0 auto',
  },
  raw: { fontSize: 11, opacity: 0.5, marginTop: 2, wordBreak: 'break-all' },
};

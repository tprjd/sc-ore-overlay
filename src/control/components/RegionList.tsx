// Shared capture-region picker UI: add/select/role/enable/upscale/delete rows
// with a per-region OCR debug crop. Used by both the Survey and Mining tabs; the
// allowed roles are passed in. Renders inner content only — the caller wraps it
// in a section/card. Drawing the box happens in CapturePreview (the caller wires
// the active region's rect).

import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SurveyRegionSetting, SurveyRole } from '../../shared/bridge';
import { Button } from '../ui';
import { cn } from '../ui/cn';
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
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">Add:</span>
        {roles.map((role) => (
          <Button key={role} variant="secondary" size="sm" onClick={() => addRegion(role)}>
            + {ROLE_META[role].label}
          </Button>
        ))}
      </div>
      {regions.length === 0 ? (
        <p className="text-xs text-muted">No regions yet. Add one to start reading the HUD.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {regions.map((r) => {
            const dbg = debug[r.id];
            const verdict = verdictColor(dbg);
            return (
              <div
                key={r.id}
                className={cn(
                  'cursor-pointer rounded-md border bg-bg p-2 transition-colors',
                  r.id === activeId ? 'border-accent' : 'border-border',
                )}
                onClick={() => onActiveChange(r.id)}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: ROLE_META[r.role].color }}
                  />
                  <select
                    className="flex-1 rounded-md border border-border-strong bg-bg px-1.5 py-1 text-[13px] text-fg"
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
                    className="flex items-center gap-0.5 text-[11px] text-muted"
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
                      className="w-9 rounded-sm border border-border-strong bg-bg px-1 py-0.5 text-xs text-fg"
                    />
                    ×
                  </label>
                  <label
                    className="flex items-center gap-1 text-xs text-fg/80"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={r.enabled}
                      onChange={(e) => updateRegion(r.id, { enabled: e.target.checked })}
                    />
                    on
                  </label>
                  <button
                    type="button"
                    className="grid h-6 w-6 place-items-center rounded-md border border-border-strong text-muted transition-colors hover:text-fg"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRegion(r.id);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 flex items-start gap-2">
                  <div
                    className="flex min-h-9 min-w-24 items-center justify-center rounded-sm border bg-black p-0.5"
                    style={{ borderColor: verdict }}
                  >
                    {dbg?.dataUrl ? (
                      <img
                        src={dbg.dataUrl}
                        alt="crop"
                        className="max-h-[60px] max-w-[140px] [image-rendering:pixelated]"
                      />
                    ) : (
                      <span className="text-xs text-muted">{r.enabled ? '…' : 'off'}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-1.5">
                      <span
                        className="min-w-0 break-all font-mono text-[13px]"
                        style={{ color: dbg?.ok ? '#6ee7b7' : '#9fb3c8' }}
                      >
                        {dbg?.parsed ?? '—'}
                      </span>
                      {dbg?.score != null && (
                        <span
                          className="tnum shrink-0 rounded-sm border px-1.5 text-[11px] font-semibold"
                          style={{ color: verdict, borderColor: verdict }}
                        >
                          {Math.round(dbg.score * 100)}%
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 break-all text-[11px] text-fg/50">
                      {dbg?.rawText ?? '(waiting)'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </>
  );
}

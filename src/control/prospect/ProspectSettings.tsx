// The right-hand settings panel: a subtab bar (Capture · Match · Overlay ·
// Hotkeys · About) over one group at a time. Presentational + local subtab
// state; all config/handlers come from the orchestrator as props. The Overlay
// tab's live preview reads per-tick runtime values (stableRs/settling/frozenScan)
// straight from the prospect store so they don't have to be threaded as props.

import { useState } from 'react';
import type { QualityDetail, SignatureTable } from '../../core';
import { DetailCard } from '../../overlay/DetailCard';
import { OverlayCard } from '../../overlay/OverlayCard';
import { ScanCard } from '../../overlay/ScanCard';
import type {
  HotkeyAction,
  HotkeyMap,
  OverlayCandidate,
  OverlayConfig,
  OverlayOcr,
  OverlayScale,
  OverlayStatus,
  SurveyRegionSetting,
} from '../../shared/bridge';
import { DEFAULT_OVERLAY_CONFIG } from '../../shared/bridge';
import { AboutPanel } from '../components/AboutPanel';
import { HOTKEY_ROWS, KeyCapture, NoiseEditor, Section, Slider } from '../components/controls';
import { matchPreset, OVERLAY_PRESETS } from '../components/presets';
import { RegionList } from '../components/RegionList';
import type { PickedSource } from '../components/SourcePicker';
import type { OcrBackend } from '../ocr';
import {
  Button,
  CheckRow,
  cn,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../ui';
import type { LoopParams } from '../useCaptureLoop';
import type { RegionDebug } from '../useSurveyCapture';
import { useProspectStore } from './store';

type PanelTab = 'capture' | 'match' | 'overlay' | 'hotkeys' | 'about';
const PANEL_TABS: Array<[PanelTab, string]> = [
  ['capture', 'Capture'],
  ['match', 'Match'],
  ['overlay', 'Overlay'],
  ['hotkeys', 'Hotkeys'],
  ['about', 'About'],
];

export interface ProspectSettingsProps {
  // Source / capture
  source: PickedSource;
  onBack: () => void;
  regions: SurveyRegionSetting[];
  onRegionsChange: (regions: SurveyRegionSetting[]) => void;
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
  debugRegions: Record<string, RegionDebug>;
  params: LoopParams;
  onParamsChange: (p: LoopParams) => void;
  ocrBackend: OcrBackend;
  effectiveBackend: OcrBackend | null;
  onOcrBackendChange: (backend: OcrBackend) => void;
  // Match
  table: SignatureTable;
  patches: string[];
  activePatch: string;
  onPatchChange: (patch: string) => void;
  location: string | null;
  onLocationChange: (location: string | null) => void;
  systemGroups: Array<{ system: string; locations: string[] }>;
  enforceCluster: boolean;
  onEnforceClusterChange: (next: boolean) => void;
  noiseSignatures: number[];
  onNoiseSignaturesChange: (sigs: number[]) => void;
  // Overlay (+ live preview)
  overlayConfig: OverlayConfig;
  onOverlayConfigChange: (config: OverlayConfig) => void;
  overlayCandidates: OverlayCandidate[];
  detail: QualityDetail | null;
  overlayStatus: OverlayStatus;
  ocr: OverlayOcr | null;
  // Hotkeys
  hotkeys: HotkeyMap;
  hotkeyStatus: Partial<Record<HotkeyAction, boolean>>;
  onHotkeysChange: (map: HotkeyMap) => void;
  // About
  onReRunSetup: () => void;
}

export function ProspectSettings(props: ProspectSettingsProps) {
  const {
    source,
    onBack,
    regions,
    onRegionsChange,
    activeId,
    onActiveChange,
    debugRegions,
    params,
    onParamsChange,
    ocrBackend,
    effectiveBackend,
    onOcrBackendChange,
    table,
    patches,
    activePatch,
    onPatchChange,
    location,
    onLocationChange,
    systemGroups,
    enforceCluster,
    onEnforceClusterChange,
    noiseSignatures,
    onNoiseSignaturesChange,
    overlayConfig,
    onOverlayConfigChange,
    overlayCandidates,
    detail,
    overlayStatus,
    ocr,
    hotkeys,
    hotkeyStatus,
    onHotkeysChange,
    onReRunSetup,
  } = props;

  const [panelTab, setPanelTab] = useState<PanelTab>('match');
  const set = <K extends keyof LoopParams>(key: K, val: LoopParams[K]): void =>
    onParamsChange({ ...params, [key]: val });

  // Live-preview runtime values come from the store, not props.
  const stableRs = useProspectStore((s) => s.stableRs);
  const settling = useProspectStore((s) => s.settling);
  const frozenScan = useProspectStore((s) => s.frozenScan);
  const activePreset = matchPreset(overlayConfig);

  return (
    <>
      <nav className="flex gap-0.5 border-b border-border px-3.5">
        {PANEL_TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={cn(
              'flex-1 border-b-2 border-transparent px-1 py-1.5 text-[11px] uppercase tracking-wide transition-colors',
              panelTab === id ? 'border-accent text-accent' : 'text-fg/50 hover:text-fg',
            )}
            onClick={() => setPanelTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {panelTab === 'match' && (
          <>
            <Section title="Match">
              <LabeledSelect
                label="Patch"
                value={activePatch}
                onChange={onPatchChange}
                options={patches.map((p) => ({ value: p, label: p }))}
              />
              <LocationSelect
                location={location}
                onChange={onLocationChange}
                systemGroups={systemGroups}
              />
              <CheckRow
                checked={enforceCluster}
                onChange={onEnforceClusterChange}
                label="Enforce cluster-size range"
                hint="Disable when the table is stale and an out-of-range node count is real."
              />
            </Section>

            <Section title="Noise signatures" defaultOpen={false}>
              <p className="text-xs text-muted">
                Non-ore signals (wrecks, satellites, debris) that can sit on top of an RS reading.
                Each value is tried as a subtraction before matching.
              </p>
              <NoiseEditor values={noiseSignatures} onChange={onNoiseSignaturesChange} />
            </Section>
          </>
        )}

        {panelTab === 'capture' && (
          <>
            <Section title="Source">
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex items-center rounded-sm bg-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide opacity-80">
                  {source.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]" title={source.label}>
                  {source.label}
                </span>
                <Button variant="secondary" size="sm" onClick={onBack}>
                  Change
                </Button>
              </div>
              <p className="text-xs text-muted">
                Switch the captured screen/window, or reconnect if the source was lost.
              </p>
            </Section>

            <Section title="Regions">
              <RegionList
                regions={regions}
                onRegionsChange={onRegionsChange}
                activeId={activeId}
                onActiveChange={onActiveChange}
                debug={debugRegions}
                roles={['rs', 'scanResult']}
                defaultScale={params.scale}
                hint="Box the RS number and the SCAN RESULTS panel."
              />
            </Section>

            <Section title="Upscale">
              <Slider
                label="Upscale"
                min={1}
                max={8}
                value={params.scale}
                onChange={(v) => set('scale', v)}
                suffix="×"
              />
              <p className="text-xs text-muted">
                Global crop upscale before OCR; override per region above.
              </p>
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
              <Slider
                label="Min confidence"
                min={0}
                max={100}
                step={5}
                value={Math.round((params.minConfidence ?? 0) * 100)}
                onChange={(v) => set('minConfidence', v / 100)}
                suffix="%"
              />
              <p className="text-xs text-muted">
                Reads below this OCR confidence are ignored (treated as no reading), so garbage
                can't move the lock. 0% = accept everything.
              </p>
            </Section>

            <Section title="OCR backend">
              <LabeledSelect
                label="Engine"
                value={ocrBackend}
                onChange={(v) => onOcrBackendChange(v as OcrBackend)}
                options={[
                  { value: 'directml', label: 'DirectML (GPU)' },
                  { value: 'wasm', label: 'WASM (CPU)' },
                  { value: 'webgpu', label: 'WebGPU (experimental)' },
                ]}
              />
              <p className="text-xs text-muted">
                {effectiveBackend && effectiveBackend !== ocrBackend
                  ? `Selected ${ocrBackend} — running on ${effectiveBackend} (fell back). `
                  : effectiveBackend
                    ? `Running on ${effectiveBackend}. `
                    : ''}
                DirectML uses any DX12 GPU and falls back to WASM if unavailable. Changing the
                engine takes effect after a relaunch.
              </p>
            </Section>
          </>
        )}

        {panelTab === 'overlay' && (
          <>
            <div className="mb-3.5">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg/65">
                Live preview
              </div>
              <div
                className="flex flex-col gap-2 rounded-lg border border-border p-2"
                style={{
                  background:
                    'repeating-conic-gradient(#3a3f4b 0% 25%, #2b2f38 0% 50%) 0 / 18px 18px',
                }}
              >
                <div className="relative h-24 overflow-hidden rounded-lg">
                  <OverlayCard
                    reading={stableRs}
                    candidates={overlayCandidates}
                    settling={settling}
                    ocr={overlayConfig.showOcrStats ? ocr : null}
                    status={overlayStatus}
                    config={overlayConfig}
                  />
                </div>
                {overlayConfig.showDetail && (
                  <div className="relative h-36 overflow-hidden rounded-lg">
                    <DetailCard detail={detail} config={overlayConfig} />
                  </div>
                )}
                {overlayConfig.showScan && (
                  <div className="relative h-36 overflow-hidden rounded-lg">
                    <ScanCard
                      scan={frozenScan}
                      config={overlayConfig}
                      onSortChange={(scanSort, scanSortDir) =>
                        onOverlayConfigChange({ ...overlayConfig, scanSort, scanSortDir })
                      }
                    />
                  </div>
                )}
              </div>
            </div>
            <Section title="Overlay">
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <span className="mr-0.5 text-xs text-fg/80">Preset</span>
                {OVERLAY_PRESETS.map(({ id, label, patch }) => (
                  <Button
                    key={id}
                    variant="secondary"
                    size="sm"
                    className={cn(activePreset === id && 'border-accent text-accent')}
                    onClick={() => onOverlayConfigChange({ ...overlayConfig, ...patch })}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  className="ml-auto"
                  onClick={() => onOverlayConfigChange(DEFAULT_OVERLAY_CONFIG)}
                  title="Restore all overlay settings to defaults"
                >
                  Reset
                </Button>
              </div>
              <LabeledSelect
                label="Fade after"
                value={String(overlayConfig.idleMs)}
                onChange={(v) => onOverlayConfigChange({ ...overlayConfig, idleMs: Number(v) })}
                options={[
                  { value: '5000', label: '5s' },
                  { value: '10000', label: '10s' },
                  { value: '30000', label: '30s' },
                  { value: '60000', label: '60s' },
                  { value: '0', label: 'Never' },
                ]}
              />
              <LabeledSelect
                label="Hold reading"
                value={String(overlayConfig.holdMs)}
                onChange={(v) => onOverlayConfigChange({ ...overlayConfig, holdMs: Number(v) })}
                options={[
                  { value: '2000', label: '2s' },
                  { value: '4000', label: '4s' },
                  { value: '10000', label: '10s' },
                  { value: '0', label: 'Never drop' },
                ]}
              />
              <p className="text-xs text-muted">
                Keep showing the last ore this long after the RS reading disappears, then clear it.
                (Fade only changes opacity; hold clears the value.)
              </p>
              <LabeledSelect
                label="Size"
                value={overlayConfig.scale}
                onChange={(v) =>
                  onOverlayConfigChange({ ...overlayConfig, scale: v as OverlayScale })
                }
                options={[
                  { value: 'compact', label: 'Compact' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'large', label: 'Large' },
                ]}
              />
              <LabeledSelect
                label="Font"
                value={overlayConfig.fontFamily}
                onChange={(v) => onOverlayConfigChange({ ...overlayConfig, fontFamily: v })}
                options={[
                  { value: 'system-ui, sans-serif', label: 'System' },
                  { value: "'Segoe UI', sans-serif", label: 'Segoe UI' },
                  { value: 'Arial, sans-serif', label: 'Arial' },
                  { value: 'Georgia, serif', label: 'Georgia' },
                  { value: "'Courier New', ui-monospace, monospace", label: 'Monospace' },
                ]}
              />
              <label className="mb-2.5 flex items-center gap-2">
                <span className="w-[82px] text-xs text-fg/80">Background</span>
                <input
                  type="color"
                  className="h-7 w-12 cursor-pointer rounded-md border border-border-strong bg-transparent p-0"
                  value={overlayConfig.bgColor}
                  onChange={(e) =>
                    onOverlayConfigChange({ ...overlayConfig, bgColor: e.target.value })
                  }
                />
              </label>
              <Slider
                label="Opacity"
                min={0}
                max={100}
                value={Math.round(overlayConfig.bgOpacity * 100)}
                onChange={(v) => onOverlayConfigChange({ ...overlayConfig, bgOpacity: v / 100 })}
                suffix="%"
              />
              <Slider
                label="Padding"
                min={0}
                max={40}
                value={overlayConfig.padding}
                onChange={(v) => onOverlayConfigChange({ ...overlayConfig, padding: v })}
                suffix=" px"
              />
              <Slider
                label="Line gap"
                min={0}
                max={24}
                value={overlayConfig.gap}
                onChange={(v) => onOverlayConfigChange({ ...overlayConfig, gap: v })}
                suffix=" px"
              />
              <CheckRow
                checked={overlayConfig.border}
                onChange={(border) => onOverlayConfigChange({ ...overlayConfig, border })}
                label="Border"
              />
              <CheckRow
                checked={overlayConfig.autoResize}
                onChange={(autoResize) => onOverlayConfigChange({ ...overlayConfig, autoResize })}
                label="Auto-fit height to content"
                hint="On: each box is exactly as tall as its content (grip resizes width only). Off: fixed height — drag the grip to resize height too."
              />
              <CheckRow
                checked={overlayConfig.showPlaceholder}
                onChange={(showPlaceholder) =>
                  onOverlayConfigChange({ ...overlayConfig, showPlaceholder })
                }
                label="Show “scanning” placeholder"
              />
              <CheckRow
                checked={overlayConfig.showDetail}
                onChange={(showDetail) => onOverlayConfigChange({ ...overlayConfig, showDetail })}
                label="Show ore detail box"
              />
              <CheckRow
                checked={overlayConfig.showScan}
                onChange={(showScan) => onOverlayConfigChange({ ...overlayConfig, showScan })}
                label="Show scanned-rock box (SCU per quality)"
              />
              <CheckRow
                checked={overlayConfig.showOcrStats}
                onChange={(showOcrStats) =>
                  onOverlayConfigChange({ ...overlayConfig, showOcrStats })
                }
                label="Show OCR stats (confidence · latency · lines)"
              />
              <p className="text-xs text-muted">
                In edit mode (Alt+Shift+E): drag to move, drag the corner grip to resize.
              </p>
            </Section>
          </>
        )}

        {panelTab === 'hotkeys' && (
          <Section title="Hotkeys">
            {HOTKEY_ROWS.map(([action, label]) => (
              <div key={action} className="mb-1.5 flex items-center gap-2">
                <span className="w-[82px] text-xs text-fg/80">{label}</span>
                <KeyCapture
                  value={hotkeys[action]}
                  onChange={(accel) => onHotkeysChange({ ...hotkeys, [action]: accel })}
                />
                {hotkeyStatus[action] === false && (
                  <span className="text-[11px] text-danger">conflict</span>
                )}
              </div>
            ))}
            <p className="text-xs text-muted">
              Click a binding, then press the combo (needs a modifier).
            </p>
          </Section>
        )}

        {panelTab === 'about' && (
          <AboutPanel table={table} hotkeys={hotkeys} onReRunSetup={onReRunSetup} />
        )}
      </div>
    </>
  );
}

/** A fixed-width-labelled Select row (the old `selectRow` pattern). */
function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <span className="w-[82px] shrink-0 text-xs text-fg/80">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Location dropdown with system optgroups + an "Anywhere" sentinel. */
function LocationSelect({
  location,
  onChange,
  systemGroups,
}: {
  location: string | null;
  onChange: (loc: string | null) => void;
  systemGroups: Array<{ system: string; locations: string[] }>;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <span className="w-[82px] shrink-0 text-xs text-fg/80">Location</span>
      <Select value={location ?? 'any'} onValueChange={(v) => onChange(v === 'any' ? null : v)}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Anywhere</SelectItem>
          {systemGroups.map((g) => (
            <SelectGroup key={g.system}>
              <SelectLabel>{g.system}</SelectLabel>
              {g.locations.map((loc) => (
                <SelectItem key={`${g.system}:${loc}`} value={loc}>
                  {loc}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

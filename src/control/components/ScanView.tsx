// Mining tab: draw capture regions (the RS number + the SCAN RESULTS panel),
// read them live, match the RS to ore(s), and push to the overlay. The RS is
// temporally voted for a stable overlay value; the scanned rock's composition
// (with per-material SCU) feeds the detail/scan overlay. Reuses the shared
// CapturePreview + RegionList + capture loop.
//
// The settings panel is grouped into sub-tabs (Match · Tuning · Overlay ·
// Hotkeys · Regions) so only one group shows at a time — no single scroll wall.
// Reusable field/section widgets live in ./controls; colors/radii in ./tokens.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { CapturePreview } from './CapturePreview';
import type { PreviewRegion } from './CapturePreview';
import { RegionList } from './RegionList';
import { ROLE_META } from './roles';
import { Section, Slider, NoiseEditor, KeyCapture, HOTKEY_ROWS } from './controls';
import { C, R } from './tokens';
import { OverlayCard } from '../../overlay/OverlayCard';
import { DetailCard } from '../../overlay/DetailCard';
import { ScanCard } from '../../overlay/ScanCard';
import type { PickedSource } from './SourcePicker';
import { useSurveyCapture } from '../useSurveyCapture';
import type { ActiveSurveyRegion } from '../useSurveyCapture';
import type { LoopParams } from '../useCaptureLoop';
import type { OcrBackend } from '../ocr';
import type { DrawableSource, NormRegion } from '../preprocess';
import {
  createVoter,
  matchWithNoise,
  groupLocations,
  getQualityDetail,
  snapMaterial,
} from '../../core';
import type { ScanResult, SignatureTable, Voter } from '../../core';
import { DEFAULT_OVERLAY_CONFIG } from '../../shared/bridge';
import type {
  HotkeyAction,
  HotkeyMap,
  OverlayConfig,
  OverlayScale,
  SurveyRegionSetting,
} from '../../shared/bridge';

/**
 * Two scans are "the same rock" when the OCR'd ore matches and the rock's
 * fingerprint (composition row count + mass) is close. Used to freeze the
 * scan box against OCR jitter while the rock stays targeted.
 */
function sameRock(a: ScanResult, b: ScanResult): boolean {
  if (a.ore.toLowerCase() !== b.ore.toLowerCase()) return false;
  if (a.composition.length !== b.composition.length) return false;
  const aMass = a.mass ?? 0;
  const bMass = b.mass ?? 0;
  if (Math.abs(aMass - bMass) > 200) return false;
  return true;
}

/** Settings-panel groups, ordered by pipeline stage: Capture → Match → Show. */
type PanelTab = 'capture' | 'match' | 'overlay' | 'hotkeys';
const PANEL_TABS: Array<[PanelTab, string]> = [
  ['capture', 'Capture'],
  ['match', 'Match'],
  ['overlay', 'Overlay'],
  ['hotkeys', 'Hotkeys'],
];

/**
 * One-click overlay presets. Each patches only scale + what shows (boxes/stats/
 * border), leaving the user's appearance fine-tuning (color, opacity, padding,
 * gap, fade, font) untouched. Reset (a separate button) restores everything.
 */
type OverlayPreset = 'minimal' | 'standard' | 'detailed';
const OVERLAY_PRESETS: Array<[OverlayPreset, string, Partial<OverlayConfig>]> = [
  ['minimal', 'Minimal', { scale: 'compact', border: false, showPlaceholder: false, showDetail: false, showScan: false, showOcrStats: false }],
  ['standard', 'Standard', { scale: 'normal', border: true, showPlaceholder: true, showDetail: false, showScan: false, showOcrStats: false }],
  ['detailed', 'Detailed', { scale: 'normal', border: true, showPlaceholder: true, showDetail: true, showScan: true, showOcrStats: true }],
];

export interface ScanViewProps {
  source: PickedSource;
  regions: SurveyRegionSetting[];
  onRegionsChange: (regions: SurveyRegionSetting[]) => void;
  noiseSignatures: number[];
  onNoiseSignaturesChange: (sigs: number[]) => void;
  enforceCluster: boolean;
  onEnforceClusterChange: (next: boolean) => void;
  params: LoopParams;
  onParamsChange: (p: LoopParams) => void;
  /** Selected OCR backend (what the user picked). */
  ocrBackend: OcrBackend;
  /** Backend actually serving reads (directml may fall back to wasm); null until resolved. */
  effectiveBackend: OcrBackend | null;
  onOcrBackendChange: (backend: OcrBackend) => void;
  table: SignatureTable;
  location: string | null;
  onLocationChange: (location: string | null) => void;
  patches: string[];
  activePatch: string;
  onPatchChange: (patch: string) => void;
  hotkeys: HotkeyMap;
  hotkeyStatus: Partial<Record<HotkeyAction, boolean>>;
  onHotkeysChange: (map: HotkeyMap) => void;
  overlayConfig: OverlayConfig;
  onOverlayConfigChange: (config: OverlayConfig) => void;
  onBack: () => void;
  /** Re-open the first-run setup wizard. */
  onSetup: () => void;
}

export function ScanView({
  source,
  regions,
  onRegionsChange,
  noiseSignatures,
  onNoiseSignaturesChange,
  enforceCluster,
  onEnforceClusterChange,
  params,
  ocrBackend,
  effectiveBackend,
  onOcrBackendChange,
  onParamsChange,
  table,
  location,
  onLocationChange,
  patches,
  activePatch,
  onPatchChange,
  hotkeys,
  hotkeyStatus,
  onHotkeysChange,
  overlayConfig,
  onOverlayConfigChange,
  onBack,
  onSetup,
}: ScanViewProps) {
  const mediaRef = useRef<DrawableSource | null>(null);
  const [paused, setPaused] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(regions[0]?.id ?? null);
  const [panelTab, setPanelTab] = useState<PanelTab>('match');

  const active: ActiveSurveyRegion[] = useMemo(
    () => regions.filter((r) => r.enabled).map((r) => ({ id: r.id, role: r.role, rect: r.rect, scale: r.scale })),
    [regions],
  );
  const readout = useSurveyCapture(mediaRef, active, params, !paused, table);

  // Temporal voting on the RS reading → a stable value for the overlay. The
  // capture loop emits a fresh readout each tick, so push every tick.
  const voter = useRef<Voter>(createVoter({ quorum: params.quorum }));
  useEffect(() => {
    voter.current = createVoter({ quorum: params.quorum });
  }, [params.quorum]);
  const [stableRs, setStableRs] = useState<number | null>(null);
  // True while the voter is accumulating a *different* value than the one shown
  // (it latches `stable` to the candidate exactly at quorum, so an in-progress
  // candidate that isn't yet `stable` means the display may be about to change).
  const [settling, setSettling] = useState(false);
  // Measured capture cadence for the status bar — a rolling rate over the last
  // few ticks (the loop targets ~1–2/s; actual depends on OCR cost).
  const tickTimes = useRef<number[]>([]);
  const [tickRate, setTickRate] = useState(0);
  useEffect(() => {
    const s = voter.current.push(readout.rs);
    setStableRs(s);
    setSettling(voter.current.candidate != null && voter.current.candidate !== s);
    const now = performance.now();
    const t = tickTimes.current;
    t.push(now);
    if (t.length > 8) t.shift();
    setTickRate(t.length >= 2 ? (t.length - 1) / ((t[t.length - 1] - t[0]) / 1000) : 0);
  }, [readout]);
  // Clear the rate window when paused so resuming doesn't show a stale gap.
  useEffect(() => {
    if (paused) {
      tickTimes.current = [];
      setTickRate(0);
    }
  }, [paused]);


  const systemGroups = useMemo(() => groupLocations(table), [table]);
  const matches = useMemo(
    () =>
      stableRs != null
        ? matchWithNoise(
            stableRs,
            table,
            { method: 'Ship', enforceCluster },
            { location },
            noiseSignatures,
          )
        : [],
    [stableRs, table, location, noiseSignatures, enforceCluster],
  );

  // Overlay-shaped candidates — shared by the live preview and the IPC payload
  // so both render identically.
  const overlayCandidates = useMemo(
    () =>
      matches.map((c) => ({
        name: c.name,
        nodes: c.nodes,
        score: c.score,
        noise: c.noise ?? null,
        loose: c.loose ?? false,
      })),
    [matches],
  );

  // Top identified ore — headlined in the Results pane. Its quality breakdown
  // feeds both the detail overlay box (via IPC) and the live preview.
  const top = matches[0];
  const detail = useMemo(
    () => (top ? getQualityDetail(table, top.name, top.signature, location) : null),
    [top, table, location],
  );

  // Known-ore vocabulary used to snap OCR'd material names to their nearest
  // legal table entry. The HUD font + tag leakage routinely turns "Agricium"
  // into "Agricius" or "Titanium (Cf)" into "Titaniumicf)" — snapMaterial
  // absorbs those without changing the underlying parsed numbers.
  const oreVocab = useMemo(() => table.deposits.map((d) => d.name), [table]);

  // Freeze the displayed scan once parseScanResult returns one — UI shifts and
  // OCR jitter would otherwise rewrite the percentages/qualities continuously.
  // Replace the frozen scan only when the OCR clearly reports a *different*
  // rock (ore name changed, row count changed, or mass differs by > 200).
  // Materials are snap-corrected against the table vocabulary at freeze time
  // so the overlay/IPC consumers see clean names without doing their own fuzzy
  // matching.
  const [frozenScan, setFrozenScan] = useState<ScanResult | null>(null);
  useEffect(() => {
    const next = readout.scan;
    if (!next) return;
    const snapped: ScanResult = {
      ...next,
      ore: snapMaterial(next.ore, oreVocab),
      composition: next.composition.map((c) => ({
        ...c,
        material: snapMaterial(c.material, oreVocab),
      })),
    };
    if (frozenScan && sameRock(frozenScan, snapped)) return;
    setFrozenScan(snapped);
  }, [readout, frozenScan, oreVocab]);

  // Push matches + top-candidate quality + the frozen scanned rock to the
  // overlay boxes. Effect deps only fire on meaningful changes so the overlay
  // doesn't re-arm its idle timer on every OCR tick.
  // Only push OCR stats to the overlay when its toggle is on — otherwise this
  // is null and stable, so the send effect doesn't re-fire every tick.
  const ocrPush = overlayConfig.showOcrStats ? readout.ocr : null;
  useEffect(() => {
    window.sco?.sendMatches?.({
      reading: stableRs,
      candidates: overlayCandidates,
      detail,
      scan: frozenScan,
      settling,
      ocr: ocrPush ? { score: ocrPush.score, ms: ocrPush.ms, lineCount: ocrPush.lineCount } : null,
    });
  }, [stableRs, overlayCandidates, detail, frozenScan, settling, ocrPush]);

  // Global-hotkey commands relayed from the main process. Recalibrate clears
  // both the regions *and* the frozen scan so the next rock takes over.
  useEffect(() => {
    return window.sco?.onCommand?.((command) => {
      if (command === 'pause') setPaused((p) => !p);
      else if (command === 'recalibrate') {
        onRegionsChange([]);
        setFrozenScan(null);
      }
    });
  }, [onRegionsChange]);

  const previewRegions: PreviewRegion[] = regions.map((r) => ({
    id: r.id,
    rect: r.rect,
    color: ROLE_META[r.role].color,
    active: r.id === activeId,
    label: ROLE_META[r.role].label,
  }));
  const onDraw = (rect: NormRegion): void => {
    if (activeId) onRegionsChange(regions.map((r) => (r.id === activeId ? { ...r, rect } : r)));
  };
  const set = <K extends keyof LoopParams>(key: K, val: LoopParams[K]): void =>
    onParamsChange({ ...params, [key]: val });

  // Status-bar derived state.
  const voterState = paused ? 'paused' : settling ? 'settling' : stableRs != null ? 'locked' : 'idle';
  const stateColor = voterState === 'locked' ? C.green : voterState === 'settling' ? C.amber : '#9fb3c8';
  const ocr = readout.ocr;
  const confPct = ocr ? Math.round(ocr.score * 100) : null;
  // PP-OCR scores run high; treat <90% as worth noticing, <70% as bad.
  const confColor = confPct == null ? '#9fb3c8' : confPct >= 90 ? C.green : confPct >= 70 ? C.amber : '#f87171';

  // Header health pill — one-glance pipeline rollup, colored by the worst
  // stage: source connected → RS region drawn → frames flowing → OCR confidence.
  const hasRsRegion = regions.some((r) => r.role === 'rs' && r.enabled);
  const capturing = !paused && tickRate > 0;
  const health = paused
    ? { color: '#9fb3c8', label: 'paused' }
    : !hasRsRegion
      ? { color: '#f87171', label: 'add RS region' }
      : !capturing
        ? { color: C.amber, label: 'starting…' }
        : confPct == null
          ? { color: C.amber, label: 'no reading' }
          : confPct >= 90
            ? { color: C.green, label: 'ready' }
            : confPct >= 70
              ? { color: C.amber, label: 'low conf' }
              : { color: '#f87171', label: 'poor conf' };
  const healthTip =
    `source ✓ · RS region ${hasRsRegion ? '✓' : '✗'} · ` +
    `reads ${capturing ? '✓' : '✗'} · conf ${confPct != null ? `${confPct}%` : '—'}`;

  // Which overlay preset (if any) the current config matches — for highlighting.
  const activePreset =
    OVERLAY_PRESETS.find(([, , patch]) =>
      Object.entries(patch).every(([k, v]) => overlayConfig[k as keyof OverlayConfig] === v),
    )?.[0] ?? null;

  return (
    <div style={S.page}>
      <header style={S.header}>
        <button style={S.btn} onClick={onBack}>← Sources</button>
        <span style={S.srcLabel}>
          <span style={S.badge}>{source.kind}</span>
          {source.label}
        </span>
        <span style={S.spacer} />
        <span style={S.health} title={healthTip}>
          <span style={{ ...S.healthDot, background: health.color }} />
          <span style={{ color: health.color }}>{health.label}</span>
          {confPct != null && <span style={S.healthConf}>{confPct}%</span>}
        </span>
        <button style={S.btn} onClick={onSetup} title="Re-run the guided setup (source, region, location)">
          Setup
        </button>
        <button style={S.btn} onClick={() => setPaused((p) => !p)}>
          {paused ? 'Resume' : 'Pause'}
        </button>
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
              : 'Add a region (RS or Scan Result), then drag a box over it on the HUD.'
          }
        />

        <div style={S.panel}>
          {/* Always-visible Results pane — the matched ore(s) never hide behind
              a sub-tab. Reading + top ore + overlap candidates (scores, noise/
              loose badges). The scanned-rock composition lives on the overlay's
              scan box + its Overlay-tab preview, not here. */}
          <div style={S.results}>
            <div style={S.hero}>
              <div style={S.heroLabel}>Accepted reading</div>
              <div style={S.heroReading}>{stableRs != null ? stableRs.toLocaleString() : '—'}</div>
              {top ? (
                <div style={S.heroOre}>
                  <span style={S.heroOreName}>
                    {top.name}
                    {top.noise != null && (
                      <span style={S.noiseBadge} title={`RS = ${top.signature * top.nodes} + ${top.noise} noise`}>
                        +{top.noise.toLocaleString()}
                      </span>
                    )}
                    {top.loose && (
                      <span style={S.looseBadge} title="Outside the table's cluster range — table may be stale.">
                        loose
                      </span>
                    )}
                  </span>
                  <span style={S.heroNodes}>×{top.nodes}</span>
                  <span style={S.heroScore}>{Math.round(top.score * 100)}%</span>
                </div>
              ) : stableRs != null ? (
                <div style={S.heroNoMatch}>no match</div>
              ) : (
                <div style={S.heroWait}>waiting for a stable reading…</div>
              )}
              <div style={S.heroMeta}>
                {paused ? 'paused' : `every ${params.intervalMs} ms · quorum ${params.quorum}`}
              </div>
            </div>

            {/* Overlap candidates — top is in the hero, so list the rest. */}
            {matches.length > 1 && (
              <div>
                <div style={S.resultsSub}>also matches</div>
                <ul style={S.candList}>
                  {matches.slice(1).map((c, i) => (
                    <li key={`${c.name}-${c.noise ?? 'n'}-${c.loose ? 'L' : 'S'}-${i}`} style={S.candRow}>
                      <span style={S.candName}>
                        {c.name}
                        {c.noise != null && (
                          <span style={S.noiseBadge} title={`RS = ${c.signature * c.nodes} + ${c.noise} noise`}>
                            +{c.noise.toLocaleString()}
                          </span>
                        )}
                        {c.loose && (
                          <span style={S.looseBadge} title="Outside the table's cluster range — table may be stale.">
                            loose
                          </span>
                        )}
                      </span>
                      <span style={S.candNodes}>×{c.nodes}</span>
                      <span style={S.candScore}>{Math.round(c.score * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Why nothing matched — the actionable hint. */}
            {stableRs != null && matches.length === 0 && (
              <p style={S.dim}>
                No ore matches {stableRs}
                {location ? ` at ${location} (try "Anywhere")` : ''}
                {enforceCluster ? '. Cluster check is on — try disabling it.' : '.'}
              </p>
            )}
          </div>

          <nav style={S.subtabs}>
            {PANEL_TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                style={{ ...S.subtab, ...(panelTab === id ? S.subtabActive : null) }}
                onClick={() => setPanelTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          <div style={S.tabScroll}>

          {panelTab === 'match' && (
            <>
              <Section title="Match">
                <label style={S.selectRow}>
                  <span style={S.sliderLabel}>Patch</span>
                  <select style={S.select} value={activePatch} onChange={(e) => onPatchChange(e.target.value)}>
                    {patches.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
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
                <label style={S.checkRow}>
                  <input
                    type="checkbox"
                    checked={enforceCluster}
                    onChange={(e) => onEnforceClusterChange(e.target.checked)}
                  />
                  <span style={S.checkLabel}>
                    Enforce cluster-size range
                    <span style={S.checkHint}>Disable when the table is stale and an out-of-range node count is real.</span>
                  </span>
                </label>
              </Section>

              <Section title="Noise signatures" defaultOpen={false}>
                <p style={S.dim}>
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
                <div style={S.sourceRow}>
                  <span style={S.badge}>{source.kind}</span>
                  <span style={S.sourceName} title={source.label}>{source.label}</span>
                  <button type="button" style={S.btn} onClick={onBack}>
                    Change
                  </button>
                </div>
                <p style={S.dim}>Switch the captured screen/window, or reconnect if the source was lost.</p>
              </Section>

              <Section title="Regions">
                <RegionList
                  regions={regions}
                  onRegionsChange={onRegionsChange}
                  activeId={activeId}
                  onActiveChange={setActiveId}
                  debug={readout.regions}
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
                <p style={S.dim}>Global crop upscale before OCR; override per region above.</p>
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

              <Section title="OCR backend">
                <label style={S.selectRow}>
                  <span style={S.sliderLabel}>Engine</span>
                  <select
                    style={S.select}
                    value={ocrBackend}
                    onChange={(e) => onOcrBackendChange(e.target.value as OcrBackend)}
                  >
                    <option value="directml">DirectML (GPU)</option>
                    <option value="wasm">WASM (CPU)</option>
                    <option value="webgpu">WebGPU (experimental)</option>
                  </select>
                </label>
                <p style={S.dim}>
                  {effectiveBackend && effectiveBackend !== ocrBackend
                    ? `Selected ${ocrBackend} — running on ${effectiveBackend} (fell back). `
                    : effectiveBackend
                      ? `Running on ${effectiveBackend}. `
                      : ''}
                  DirectML uses any DX12 GPU and falls back to WASM if unavailable.
                  Changing the engine takes effect after a relaunch.
                </p>
              </Section>
            </>
          )}

          {panelTab === 'overlay' && (
            <>
            <div style={S.previewWrap}>
              <div style={S.previewLabel}>Live preview</div>
              <div style={S.previewStage}>
                <div style={S.previewBox}>
                  <OverlayCard
                    reading={stableRs}
                    candidates={overlayCandidates}
                    settling={settling}
                    ocr={overlayConfig.showOcrStats ? readout.ocr : null}
                    config={overlayConfig}
                  />
                </div>
                {overlayConfig.showDetail && (
                  <div style={S.previewBoxTall}>
                    <DetailCard detail={detail} config={overlayConfig} />
                  </div>
                )}
                {overlayConfig.showScan && (
                  <div style={S.previewBoxTall}>
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
              <div style={S.presetRow}>
                <span style={S.presetLabel}>Preset</span>
                {OVERLAY_PRESETS.map(([id, label, patch]) => (
                  <button
                    key={id}
                    type="button"
                    style={{ ...S.presetBtn, ...(activePreset === id ? S.presetBtnActive : null) }}
                    onClick={() => onOverlayConfigChange({ ...overlayConfig, ...patch })}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  style={{ ...S.presetBtn, marginLeft: 'auto' }}
                  onClick={() => onOverlayConfigChange(DEFAULT_OVERLAY_CONFIG)}
                  title="Restore all overlay settings to defaults"
                >
                  Reset
                </button>
              </div>
              <label style={S.selectRow}>
                <span style={S.sliderLabel}>Fade after</span>
                <select
                  style={S.select}
                  value={overlayConfig.idleMs}
                  onChange={(e) =>
                    onOverlayConfigChange({ ...overlayConfig, idleMs: Number(e.target.value) })
                  }
                >
                  <option value={5000}>5s</option>
                  <option value={10000}>10s</option>
                  <option value={30000}>30s</option>
                  <option value={60000}>60s</option>
                  <option value={0}>Never</option>
                </select>
              </label>
              <label style={S.selectRow}>
                <span style={S.sliderLabel}>Size</span>
                <select
                  style={S.select}
                  value={overlayConfig.scale}
                  onChange={(e) =>
                    onOverlayConfigChange({ ...overlayConfig, scale: e.target.value as OverlayScale })
                  }
                >
                  <option value="compact">Compact</option>
                  <option value="normal">Normal</option>
                  <option value="large">Large</option>
                </select>
              </label>
              <label style={S.selectRow}>
                <span style={S.sliderLabel}>Font</span>
                <select
                  style={S.select}
                  value={overlayConfig.fontFamily}
                  onChange={(e) => onOverlayConfigChange({ ...overlayConfig, fontFamily: e.target.value })}
                >
                  <option value="system-ui, sans-serif">System</option>
                  <option value="'Segoe UI', sans-serif">Segoe UI</option>
                  <option value="Arial, sans-serif">Arial</option>
                  <option value="Georgia, serif">Georgia</option>
                  <option value="'Courier New', ui-monospace, monospace">Monospace</option>
                </select>
              </label>
              <label style={S.selectRow}>
                <span style={S.sliderLabel}>Background</span>
                <input
                  type="color"
                  style={S.color}
                  value={overlayConfig.bgColor}
                  onChange={(e) => onOverlayConfigChange({ ...overlayConfig, bgColor: e.target.value })}
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
              <label style={S.checkRow}>
                <input
                  type="checkbox"
                  checked={overlayConfig.border}
                  onChange={(e) => onOverlayConfigChange({ ...overlayConfig, border: e.target.checked })}
                />
                Border
              </label>
              <label style={S.checkRow}>
                <input
                  type="checkbox"
                  checked={overlayConfig.showPlaceholder}
                  onChange={(e) =>
                    onOverlayConfigChange({ ...overlayConfig, showPlaceholder: e.target.checked })
                  }
                />
                Show “scanning” placeholder
              </label>
              <label style={S.checkRow}>
                <input
                  type="checkbox"
                  checked={overlayConfig.showDetail}
                  onChange={(e) =>
                    onOverlayConfigChange({ ...overlayConfig, showDetail: e.target.checked })
                  }
                />
                Show ore detail box
              </label>
              <label style={S.checkRow}>
                <input
                  type="checkbox"
                  checked={overlayConfig.showScan}
                  onChange={(e) =>
                    onOverlayConfigChange({ ...overlayConfig, showScan: e.target.checked })
                  }
                />
                Show scanned-rock box (SCU per quality)
              </label>
              <label style={S.checkRow}>
                <input
                  type="checkbox"
                  checked={overlayConfig.showOcrStats}
                  onChange={(e) =>
                    onOverlayConfigChange({ ...overlayConfig, showOcrStats: e.target.checked })
                  }
                />
                Show OCR stats (confidence · latency · lines)
              </label>
              <p style={S.dim}>In edit mode (Alt+Shift+E): drag to move, drag the corner grip to resize.</p>
            </Section>
            </>
          )}

          {panelTab === 'hotkeys' && (
            <Section title="Hotkeys">
              {HOTKEY_ROWS.map(([action, label]) => (
                <div key={action} style={S.hotkeyRow}>
                  <span style={S.sliderLabel}>{label}</span>
                  <KeyCapture
                    value={hotkeys[action]}
                    onChange={(accel) => onHotkeysChange({ ...hotkeys, [action]: accel })}
                  />
                  {hotkeyStatus[action] === false && <span style={S.hotkeyErr}>conflict</span>}
                </div>
              ))}
              <p style={S.dim}>Click a binding, then press the combo (needs a modifier).</p>
            </Section>
          )}

          </div>
        </div>
      </div>

      <footer style={S.statusbar}>
        <span style={S.statusItem}>
          <span style={S.statusKey}>RS</span>
          <span style={S.statusVal}>{stableRs != null ? stableRs.toLocaleString() : '—'}</span>
        </span>
        <span style={S.statusItem}>
          <span style={{ ...S.stateDot, background: stateColor }} />
          <span style={{ color: stateColor }}>{voterState}</span>
        </span>
        <span style={S.statusItem}>
          <span style={S.statusKey}>rate</span>
          <span style={S.statusVal}>{paused ? '—' : tickRate > 0 ? `${tickRate.toFixed(1)}/s` : '…'}</span>
        </span>
        <span style={S.statusItem} title="RS OCR confidence (best detected line)">
          <span style={S.statusKey}>conf</span>
          <span style={{ ...S.statusVal, color: confColor }}>{confPct != null ? `${confPct}%` : '—'}</span>
        </span>
        <span style={S.statusItem} title="OCR latency · detected line count">
          <span style={S.statusKey}>ocr</span>
          <span style={S.statusVal}>{ocr ? `${ocr.ms}ms · ${ocr.lineCount}L` : '—'}</span>
        </span>
        <span style={S.statusItem} title="Active OCR engine (after any directml→wasm fallback)">
          <span style={S.statusKey}>eng</span>
          <span style={S.statusVal}>{effectiveBackend ?? '…'}</span>
        </span>
        <span style={{ ...S.statusItem, marginLeft: 'auto', minWidth: 0 }} title={ocr?.rawText || ''}>
          <span style={S.statusKey}>raw</span>
          <span style={{ ...S.statusVal, fontWeight: 400, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ocr?.rawText || '—'}
          </span>
        </span>
      </footer>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100%', color: C.text, boxSizing: 'border-box' },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${C.border}` },
  srcLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, opacity: 0.9 },
  spacer: { flex: 1 },
  health: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: C.surface, border: `1px solid ${C.border}` },
  healthDot: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' },
  healthConf: { color: '#9fb3c8', fontVariantNumeric: 'tabular-nums' },
  body: { display: 'flex', flex: 1, minHeight: 0 },
  panel: { width: 380, borderLeft: `1px solid ${C.border}`, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', minHeight: 0 },
  // Always-visible Results pane: caps its own height and scrolls internally so
  // the sub-tab bar and tab content below stay reachable.
  results: { padding: 14, borderBottom: `1px solid ${C.border}`, overflowY: 'auto', maxHeight: '48%', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  hero: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: R.lg, padding: 12, textAlign: 'center' },
  heroLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 },
  heroReading: { fontSize: 40, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, color: C.accent },
  heroOre: { display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 8, marginTop: 2 },
  heroOreName: { fontSize: 18, fontWeight: 700, display: 'inline-flex', alignItems: 'baseline', gap: 6 },
  heroNodes: { fontSize: 18, fontWeight: 700, color: C.accent, fontVariantNumeric: 'tabular-nums' },
  heroScore: { fontSize: 12, opacity: 0.5 },
  heroNoMatch: { fontSize: 14, color: C.danger, marginTop: 2 },
  heroWait: { fontSize: 13, opacity: 0.5, marginTop: 2 },
  heroMeta: { fontSize: 11, opacity: 0.55, marginTop: 4 },
  resultsSub: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.5, marginBottom: 4 },
  tabScroll: { flex: 1, minHeight: 0, overflowY: 'auto', padding: 14 },
  subtabs: { display: 'flex', gap: 2, padding: '0 14px', borderBottom: `1px solid ${C.border}` },
  subtab: { flex: 1, background: 'none', color: C.text, opacity: 0.5, border: 'none', borderBottom: '2px solid transparent', padding: '6px 4px', cursor: 'pointer', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  subtabActive: { opacity: 1, color: C.accent, borderBottom: `2px solid ${C.accent}` },
  statusbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '6px 14px',
    borderTop: `1px solid ${C.border}`,
    background: C.surfaceAlt,
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
  },
  statusItem: { display: 'flex', alignItems: 'center', gap: 5 },
  statusKey: { opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.4 },
  statusVal: { color: C.text, fontWeight: 600 },
  stateDot: { width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto' },
  presetRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  presetLabel: { fontSize: 12, opacity: 0.8, marginRight: 2 },
  presetBtn: { background: C.btn, color: C.text, border: `1px solid ${C.borderStrong}`, borderRadius: R.md, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  presetBtnActive: { borderColor: C.accent, color: C.accent },
  previewWrap: { marginBottom: 14 },
  previewLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.65,
    fontWeight: 600,
    marginBottom: 6,
  },
  previewStage: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 8,
    borderRadius: R.lg,
    border: `1px solid ${C.border}`,
    // Checkerboard backdrop so the cards' translucency reads like it would over
    // the game (the overlay is transparent in-game).
    background: 'repeating-conic-gradient(#3a3f4b 0% 25%, #2b2f38 0% 50%) 0 / 18px 18px',
  },
  // Each preview card sits in its own sized box (the cards are height:100%).
  previewBox: { position: 'relative', height: 96, borderRadius: R.lg, overflow: 'hidden' },
  previewBoxTall: { position: 'relative', height: 140, borderRadius: R.lg, overflow: 'hidden' },
  dim: { opacity: 0.45, fontSize: 12 },
  sliderLabel: { width: 82, fontSize: 12, opacity: 0.8 },
  checkRow: { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, marginBottom: 10, lineHeight: 1.35 },
  checkLabel: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
  checkHint: { fontSize: 11, opacity: 0.5 },
  btn: { background: C.btn, color: C.text, border: `1px solid ${C.borderStrong}`, borderRadius: R.md, padding: '6px 10px', cursor: 'pointer', fontSize: 13 },
  badge: { fontSize: 10, textTransform: 'uppercase', background: C.border, borderRadius: R.sm, padding: '2px 5px', opacity: 0.8 },
  sourceRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  sourceName: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 },
  selectRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  select: { flex: 1, background: C.bg, color: C.text, border: `1px solid ${C.borderStrong}`, borderRadius: R.md, padding: '6px 8px', fontSize: 13 },
  candList: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  candRow: { display: 'flex', alignItems: 'baseline', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: R.md, padding: '8px 10px' },
  candName: { flex: 1, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'baseline', gap: 6 },
  noiseBadge: { fontSize: 10, padding: '1px 5px', background: '#3a2a1a', color: C.amber, border: '1px solid #5a3a1f', borderRadius: R.sm, fontVariantNumeric: 'tabular-nums', fontWeight: 600 },
  looseBadge: { fontSize: 10, padding: '1px 5px', background: '#2a1a3a', color: C.purple, border: '1px solid #4a2a5a', borderRadius: R.sm, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 },
  candNodes: { fontSize: 16, color: C.accent, fontVariantNumeric: 'tabular-nums' },
  candScore: { fontSize: 11, opacity: 0.5, width: 40, textAlign: 'right' },
  hotkeyRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  hotkeyErr: { fontSize: 11, color: C.danger },
  color: { width: 48, height: 28, padding: 0, background: 'transparent', border: `1px solid ${C.borderStrong}`, borderRadius: R.md, cursor: 'pointer' },
};

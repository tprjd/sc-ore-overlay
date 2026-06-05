// Mining tab: draw capture regions (the RS number + the SCAN RESULTS panel),
// read them live, match the RS to ore(s), and push to the overlay. The RS is
// temporally voted for a stable overlay value; the scanned rock's composition
// (with per-material SCU) feeds the detail/scan overlay. Reuses the shared
// CapturePreview + RegionList + capture loop.
//
// The settings panel is grouped into sub-tabs (Capture · Match · Overlay ·
// Hotkeys · About) so only one group shows at a time — no single scroll wall.
// Reusable field/section widgets live in ./controls; design system in ../ui.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScanResult, SignatureTable, Voter } from '../../core';
import {
  createVoter,
  getQualityDetail,
  groupLocations,
  isExpired,
  matchWithNoise,
  snapMaterial,
} from '../../core';
import { DetailCard } from '../../overlay/DetailCard';
import { OverlayCard } from '../../overlay/OverlayCard';
import { ScanCard } from '../../overlay/ScanCard';
import type {
  HotkeyAction,
  HotkeyMap,
  OverlayConfig,
  OverlayScale,
  OverlayStatus,
  SurveyRegionSetting,
} from '../../shared/bridge';
import { DEFAULT_OVERLAY_CONFIG } from '../../shared/bridge';
import type { OcrBackend } from '../ocr';
import type { DrawableSource, NormRegion } from '../preprocess';
import {
  Button,
  CheckRow,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../ui';
import { cn } from '../ui/cn';
import type { LoopParams } from '../useCaptureLoop';
import type { ActiveSurveyRegion } from '../useSurveyCapture';
import { useSurveyCapture } from '../useSurveyCapture';
import { AboutPanel } from './AboutPanel';
import type { PreviewRegion } from './CapturePreview';
import { CapturePreview } from './CapturePreview';
import { HOTKEY_ROWS, KeyCapture, NoiseEditor, Section, Slider } from './controls';
import { matchPreset, OVERLAY_PRESETS } from './presets';
import { RegionList } from './RegionList';
import { ROLE_META } from './roles';
import type { PickedSource } from './SourcePicker';

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
type PanelTab = 'capture' | 'match' | 'overlay' | 'hotkeys' | 'about';
const PANEL_TABS: Array<[PanelTab, string]> = [
  ['capture', 'Capture'],
  ['match', 'Match'],
  ['overlay', 'Overlay'],
  ['hotkeys', 'Hotkeys'],
  ['about', 'About'],
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
  /** Re-select the lost source (back to the picker with auto-reconnect armed). */
  onReconnect: () => void;
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
  onParamsChange,
  ocrBackend,
  effectiveBackend,
  onOcrBackendChange,
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
  onReconnect,
  onSetup,
}: ScanViewProps) {
  const mediaRef = useRef<DrawableSource | null>(null);
  const [paused, setPaused] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(regions[0]?.id ?? null);
  const [panelTab, setPanelTab] = useState<PanelTab>('match');

  const active: ActiveSurveyRegion[] = useMemo(
    () =>
      regions
        .filter((r) => r.enabled)
        .map((r) => ({ id: r.id, role: r.role, rect: r.rect, scale: r.scale })),
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
  // Read-pipeline reason for what the overlay shows — feeds the status footer +
  // overlay reason chip so a blank overlay explains itself.
  const [readState, setReadState] = useState<'reading' | 'held' | 'expired' | 'low-conf' | 'no-rs'>(
    'no-rs',
  );
  // performance.now() of the last *valid* RS reading — drives hold-then-drop.
  const lastValidAt = useRef<number | null>(null);
  // Whether a valid reading has ever been seen (expired vs never-read).
  const hadReading = useRef(false);
  // Measured capture cadence for the status bar — a rolling rate over the last
  // few ticks (the loop targets ~1–2/s; actual depends on OCR cost).
  const tickTimes = useRef<number[]>([]);
  const [tickRate, setTickRate] = useState(0);

  const minConf = params.minConfidence ?? 0;
  const holdMs = overlayConfig.holdMs;

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on `readout` only — minConf/holdMs are read deliberately and must not re-fire the effect per render.
  useEffect(() => {
    const reading = readout.rs;
    const now = performance.now();
    const ocr = readout.ocr;
    // A read below the confidence gate arrives as null (gated upstream); detect
    // the low-conf case here so we can say *why* nothing showed.
    const lowConf = ocr != null && ocr.score < minConf;
    if (reading != null) {
      lastValidAt.current = now;
      hadReading.current = true;
      const s = voter.current.push(reading);
      setStableRs(s);
      setSettling(voter.current.candidate != null && voter.current.candidate !== s);
      setReadState('reading');
    } else if (!isExpired(lastValidAt.current, now, holdMs)) {
      // No fresh read but within the hold window: keep the last value on screen.
      const shown = voter.current.stable;
      setReadState(shown != null ? 'held' : lowConf ? 'low-conf' : 'no-rs');
    } else {
      // Hold elapsed: drop the latched value so the overlay clears.
      voter.current.reset();
      lastValidAt.current = null;
      setStableRs(null);
      setSettling(false);
      setReadState(lowConf ? 'low-conf' : hadReading.current ? 'expired' : 'no-rs');
    }
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

  // Source-lost detection: a captured desktop/window stream can die (game closed,
  // display unplugged). Watch its video tracks for `ended`/poll `readyState`;
  // when lost, the overlay is told to vanish entirely. Image/video-file sources
  // can't be "lost", so this only arms for live streams.
  const [sourceLost, setSourceLost] = useState(false);
  useEffect(() => {
    setSourceLost(false);
    const stream = source.stream;
    if (!stream) return;
    const tracks = stream.getVideoTracks();
    const onEnded = (): void => setSourceLost(true);
    tracks.forEach((t) => {
      t.addEventListener('ended', onEnded);
    });
    const id = window.setInterval(() => {
      if (tracks.some((t) => t.readyState === 'ended')) setSourceLost(true);
    }, 1000);
    return () => {
      tracks.forEach((t) => {
        t.removeEventListener('ended', onEnded);
      });
      window.clearInterval(id);
    };
  }, [source]);

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
  const [frozenScan, setFrozenScan] = useState<ScanResult | null>(null);
  const lastScanAt = useRef<number | null>(null);
  useEffect(() => {
    const next = readout.scan;
    const now = performance.now();
    if (!next) {
      if (frozenScan && isExpired(lastScanAt.current, now, holdMs)) {
        setFrozenScan(null);
        lastScanAt.current = null;
      }
      return;
    }
    lastScanAt.current = now;
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
  }, [readout, frozenScan, oreVocab, holdMs]);

  // Only push OCR stats to the overlay when its toggle is on — otherwise this
  // is null and stable, so the send effect doesn't re-fire every tick.
  const ocrPush = overlayConfig.showOcrStats ? readout.ocr : null;

  // Is a SCAN RESULTS region enabled? Only then is a missing scan panel worth
  // reporting (no-scan) rather than silence.
  const hasScanRegion = regions.some((r) => r.role === 'scanResult' && r.enabled);

  // Single source of truth for *why* the overlay shows (or doesn't) what it does.
  const overlayStatus: OverlayStatus = sourceLost
    ? 'source-lost'
    : paused
      ? 'paused'
      : readState === 'held'
        ? 'held'
        : stableRs != null
          ? matches.length > 0
            ? 'ok'
            : 'no-match'
          : readState === 'low-conf'
            ? 'low-conf'
            : readState === 'expired'
              ? 'expired'
              : hasScanRegion && !frozenScan && readout.rs == null
                ? 'no-scan'
                : 'no-rs';

  useEffect(() => {
    // On source loss, clear everything so the overlay vanishes — don't ship a
    // frozen last frame. The status tells the overlay to force-hide.
    window.sco?.sendMatches?.({
      reading: sourceLost ? null : stableRs,
      candidates: sourceLost ? [] : overlayCandidates,
      detail: sourceLost ? null : detail,
      scan: sourceLost ? null : frozenScan,
      settling,
      ocr: ocrPush ? { score: ocrPush.score, ms: ocrPush.ms, lineCount: ocrPush.lineCount } : null,
      status: overlayStatus,
    });
  }, [
    stableRs,
    overlayCandidates,
    detail,
    frozenScan,
    settling,
    ocrPush,
    overlayStatus,
    sourceLost,
  ]);

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

  // Status-bar derived state. Maps the overlay status (plus the settling
  // sub-state) to a human label + color so the footer says *why* nothing shows.
  const STATUS_META: Record<OverlayStatus, { label: string; color: string }> = {
    ok: { label: 'locked', color: '#6ee7b7' },
    'no-match': { label: 'no match', color: '#fbbf24' },
    held: { label: 'held', color: '#fbbf24' },
    expired: { label: 'expired', color: '#f87171' },
    'low-conf': { label: 'low conf', color: '#f87171' },
    'no-scan': { label: 'no scan panel', color: '#fbbf24' },
    'no-rs': { label: 'no RS', color: '#9fb3c8' },
    'source-lost': { label: 'source lost', color: '#f87171' },
    paused: { label: 'paused', color: '#9fb3c8' },
  };
  const voterMeta =
    !paused && !sourceLost && settling && overlayStatus === 'ok'
      ? { label: 'settling', color: '#fbbf24' }
      : STATUS_META[overlayStatus];
  const voterState = voterMeta.label;
  const stateColor = voterMeta.color;
  const ocr = readout.ocr;
  const confPct = ocr ? Math.round(ocr.score * 100) : null;
  // PP-OCR scores run high; treat <90% as worth noticing, <70% as bad.
  const confColor =
    confPct == null ? '#9fb3c8' : confPct >= 90 ? '#6ee7b7' : confPct >= 70 ? '#fbbf24' : '#f87171';

  // Header health pill — one-glance pipeline rollup, colored by the worst stage.
  const hasRsRegion = regions.some((r) => r.role === 'rs' && r.enabled);
  const capturing = !paused && !sourceLost && tickRate > 0;
  const health = sourceLost
    ? { color: '#f87171', label: 'source lost' }
    : paused
      ? { color: '#9fb3c8', label: 'paused' }
      : !hasRsRegion
        ? { color: '#f87171', label: 'add RS region' }
        : !capturing
          ? { color: '#fbbf24', label: 'starting…' }
          : confPct == null
            ? { color: '#fbbf24', label: 'no reading' }
            : confPct >= 90
              ? { color: '#6ee7b7', label: 'ready' }
              : confPct >= 70
                ? { color: '#fbbf24', label: 'low conf' }
                : { color: '#f87171', label: 'poor conf' };
  const healthTip =
    `source ${sourceLost ? '✗ lost' : '✓'} · RS region ${hasRsRegion ? '✓' : '✗'} · ` +
    `reads ${capturing ? '✓' : '✗'} · conf ${confPct != null ? `${confPct}%` : '—'}`;

  const activePreset = matchPreset(overlayConfig);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5">
        <Button variant="secondary" size="sm" onClick={onBack}>
          ← Sources
        </Button>
        <span className="flex items-center gap-1.5 text-[13px] text-fg/90">
          <span className="inline-flex items-center rounded-sm bg-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide opacity-80">
            {source.kind}
          </span>
          {source.label}
        </span>
        <span className="flex-1" />
        <span
          className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-semibold"
          title={healthTip}
        >
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: health.color }} />
          <span style={{ color: health.color }}>{health.label}</span>
          {confPct != null && <span className="tnum text-muted">{confPct}%</span>}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={onSetup}
          title="Re-run the guided setup (source, region, location)"
        >
          Setup
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setPaused((p) => !p)}>
          {paused ? 'Resume' : 'Pause'}
        </Button>
      </header>

      {sourceLost && (
        <div className="flex items-center gap-2.5 border-b border-[#6b2f2f] bg-[#3a1d1d] px-3.5 py-2 text-[13px]">
          <span className="h-2 w-2 shrink-0 rounded-full bg-[#f87171]" />
          <span className="text-[#fca5a5]">
            <b>Capture source lost.</b> The shared screen/window is gone — the overlay is hidden
            until it's back.
          </span>
          <span className="flex-1" />
          <Button variant="danger" size="sm" onClick={onReconnect}>
            Reconnect
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
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

        <div className="flex w-[380px] min-h-0 flex-col border-l border-border">
          {/* Always-visible Results pane — the matched ore(s) never hide behind a sub-tab. */}
          <div className="flex max-h-[48%] shrink-0 flex-col gap-2 overflow-y-auto border-b border-border p-3.5">
            <div className="rounded-lg border border-border bg-surface p-3 text-center">
              <div className="text-[11px] uppercase tracking-wide text-muted">Accepted reading</div>
              <div className="tnum text-4xl font-bold leading-tight text-accent">
                {stableRs != null ? stableRs.toLocaleString() : '—'}
              </div>
              {top ? (
                <div className="mt-0.5 flex items-baseline justify-center gap-2">
                  <span className="inline-flex items-baseline gap-1.5 text-lg font-bold">
                    {top.name}
                    {top.noise != null && (
                      <NoiseBadge value={top.noise} sig={top.signature} nodes={top.nodes} />
                    )}
                    {top.loose && <LooseBadge />}
                  </span>
                  <span className="tnum text-lg font-bold text-accent">×{top.nodes}</span>
                  <span className="text-xs text-fg/50">{Math.round(top.score * 100)}%</span>
                </div>
              ) : stableRs != null ? (
                <div className="mt-0.5 text-sm text-danger">no match</div>
              ) : (
                <div className="mt-0.5 text-[13px] text-fg/50">waiting for a stable reading…</div>
              )}
              <div className="mt-1 text-[11px] text-fg/55">
                {paused ? 'paused' : `every ${params.intervalMs} ms · quorum ${params.quorum}`}
              </div>
            </div>

            {matches.length > 1 && (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-fg/50">
                  also matches
                </div>
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {matches.slice(1).map((c, i) => (
                    <li
                      key={`${c.name}-${c.noise ?? 'n'}-${c.loose ? 'L' : 'S'}-${i}`}
                      className="flex items-baseline gap-2 rounded-md border border-border bg-surface px-2.5 py-2"
                    >
                      <span className="flex flex-1 items-baseline gap-1.5 text-base font-semibold">
                        {c.name}
                        {c.noise != null && (
                          <NoiseBadge value={c.noise} sig={c.signature} nodes={c.nodes} />
                        )}
                        {c.loose && <LooseBadge />}
                      </span>
                      <span className="tnum text-base text-accent">×{c.nodes}</span>
                      <span className="w-10 text-right text-[11px] text-fg/50">
                        {Math.round(c.score * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {stableRs != null && matches.length === 0 && (
              <p className="text-xs text-muted">
                No ore matches {stableRs}
                {location ? ` at ${location} (try "Anywhere")` : ''}
                {enforceCluster ? '. Cluster check is on — try disabling it.' : '.'}
              </p>
            )}
          </div>

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
                    Non-ore signals (wrecks, satellites, debris) that can sit on top of an RS
                    reading. Each value is tried as a subtraction before matching.
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
                        ocr={overlayConfig.showOcrStats ? readout.ocr : null}
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
                    Keep showing the last ore this long after the RS reading disappears, then clear
                    it. (Fade only changes opacity; hold clears the value.)
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
                    onChange={(v) =>
                      onOverlayConfigChange({ ...overlayConfig, bgOpacity: v / 100 })
                    }
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
                    onChange={(autoResize) =>
                      onOverlayConfigChange({ ...overlayConfig, autoResize })
                    }
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
                    onChange={(showDetail) =>
                      onOverlayConfigChange({ ...overlayConfig, showDetail })
                    }
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
              <AboutPanel table={table} hotkeys={hotkeys} onReRunSetup={onSetup} />
            )}
          </div>
        </div>
      </div>

      <footer className="tnum flex items-center gap-4 border-t border-border bg-surface-alt px-3.5 py-1.5 text-[11px]">
        <StatItem label="RS" value={stableRs != null ? stableRs.toLocaleString() : '—'} />
        <span className="flex items-center gap-1.5">
          <span
            className="h-[7px] w-[7px] shrink-0 rounded-full"
            style={{ background: stateColor }}
          />
          <span style={{ color: stateColor }}>{voterState}</span>
        </span>
        <StatItem
          label="rate"
          value={paused ? '—' : tickRate > 0 ? `${tickRate.toFixed(1)}/s` : '…'}
        />
        <span className="flex items-center gap-1.5" title="RS OCR confidence (best detected line)">
          <span className="uppercase tracking-wide text-fg/50">conf</span>
          <span className="font-semibold" style={{ color: confColor }}>
            {confPct != null ? `${confPct}%` : '—'}
          </span>
        </span>
        <StatItem label="ocr" value={ocr ? `${ocr.ms}ms · ${ocr.lineCount}L` : '—'} />
        <StatItem label="eng" value={effectiveBackend ?? '…'} />
        <span className="ml-auto flex min-w-0 items-center gap-1.5" title={ocr?.rawText || ''}>
          <span className="uppercase tracking-wide text-fg/50">raw</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-normal text-fg/80">
            {ocr?.rawText || '—'}
          </span>
        </span>
      </footer>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="uppercase tracking-wide text-fg/50">{label}</span>
      <span className="font-semibold text-fg">{value}</span>
    </span>
  );
}

function NoiseBadge({ value, sig, nodes }: { value: number; sig: number; nodes: number }) {
  return (
    <span
      className="tnum rounded-sm border border-[#5a3a1f] bg-[#3a2a1a] px-1.5 py-px text-[10px] font-semibold text-amber"
      title={`RS = ${sig * nodes} + ${value} noise`}
    >
      +{value.toLocaleString()}
    </span>
  );
}

function LooseBadge() {
  return (
    <span
      className="rounded-sm border border-[#4a2a5a] bg-[#2a1a3a] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-purple"
      title="Outside the table's cluster range — table may be stale."
    >
      loose
    </span>
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

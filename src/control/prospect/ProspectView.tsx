// Prospect tab orchestrator (formerly ScanView): wire the capture loop into the
// prospect store, derive matches/detail, and lay out the header + capture preview
// + results + settings + status bar. The per-tick pipeline state (voting/hold/
// expire, scan-freeze, source-lost, tick rate) lives in the store; the heavy
// logic is the pure nextReadingState / deriveStatus modules. This file is just
// glue + layout. The user-facing tab is still labelled "Mining".

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SignatureTable } from '../../core';
import { getQualityDetail, groupLocations, matchWithNoise } from '../../core';
import type {
  HotkeyAction,
  HotkeyMap,
  OverlayConfig,
  OverlayStatus,
  SurveyRegionSetting,
} from '../../shared/bridge';
import type { PreviewRegion } from '../components/CapturePreview';
import { CapturePreview } from '../components/CapturePreview';
import { ROLE_META } from '../components/roles';
import type { PickedSource } from '../components/SourcePicker';
import type { OcrBackend } from '../ocr';
import type { DrawableSource, NormRegion } from '../preprocess';
import { Button } from '../ui';
import type { LoopParams } from '../useCaptureLoop';
import type { ActiveSurveyRegion } from '../useSurveyCapture';
import { useSurveyCapture } from '../useSurveyCapture';
import { ProspectResults } from './ProspectResults';
import { ProspectSettings } from './ProspectSettings';
import { ProspectStatusBar } from './ProspectStatusBar';
import { deriveHealth, deriveOverlayStatus, STATUS_META } from './status';
import { useProspectStore } from './store';
import { useSourceLost } from './useSourceLost';

export interface ProspectViewProps {
  source: PickedSource;
  regions: SurveyRegionSetting[];
  onRegionsChange: (regions: SurveyRegionSetting[]) => void;
  noiseSignatures: number[];
  onNoiseSignaturesChange: (sigs: number[]) => void;
  enforceCluster: boolean;
  onEnforceClusterChange: (next: boolean) => void;
  params: LoopParams;
  onParamsChange: (p: LoopParams) => void;
  ocrBackend: OcrBackend;
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

export function ProspectView(props: ProspectViewProps) {
  const {
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
  } = props;

  const mediaRef = useRef<DrawableSource | null>(null);
  const [activeId, setActiveId] = useState<string | null>(regions[0]?.id ?? null);

  // ---- Store wiring --------------------------------------------------------
  const stableRs = useProspectStore((s) => s.stableRs);
  const settling = useProspectStore((s) => s.settling);
  const readState = useProspectStore((s) => s.readState);
  const tickRate = useProspectStore((s) => s.tickRate);
  const sourceLost = useProspectStore((s) => s.sourceLost);
  const frozenScan = useProspectStore((s) => s.frozenScan);
  const paused = useProspectStore((s) => s.paused);
  const configure = useProspectStore((s) => s.configure);
  const pushReadout = useProspectStore((s) => s.pushReadout);
  const pushScan = useProspectStore((s) => s.pushScan);
  const togglePause = useProspectStore((s) => s.togglePause);
  const recalibrate = useProspectStore((s) => s.recalibrate);
  const reset = useProspectStore((s) => s.reset);

  // Fresh pipeline state each time the view mounts; clear it on unmount so a
  // stale reading/scan can't leak into the next session (the store is a singleton).
  useEffect(() => {
    reset();
    return reset;
  }, [reset]);

  // Keep the store's config snapshot in sync with the user's settings.
  useEffect(() => {
    configure({
      quorum: params.quorum,
      minConf: params.minConfidence ?? 0,
      holdMs: overlayConfig.holdMs,
    });
  }, [params.quorum, params.minConfidence, overlayConfig.holdMs, configure]);

  const active: ActiveSurveyRegion[] = useMemo(
    () =>
      regions
        .filter((r) => r.enabled)
        .map((r) => ({ id: r.id, role: r.role, rect: r.rect, scale: r.scale })),
    [regions],
  );
  const readout = useSurveyCapture(mediaRef, active, params, !paused, table);

  // Known-ore vocabulary used to snap OCR'd material names to their nearest legal
  // table entry at scan-freeze time.
  const oreVocab = useMemo(() => table.deposits.map((d) => d.name), [table]);

  // Forward each capture tick into the store (one performance.now() for both).
  useEffect(() => {
    const now = performance.now();
    pushReadout(readout.rs, readout.ocr?.score ?? null, now);
    pushScan(readout.scan, oreVocab, now);
  }, [readout, oreVocab, pushReadout, pushScan]);

  useSourceLost(source);

  // ---- Derivations ---------------------------------------------------------
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
  const top = matches[0];
  const detail = useMemo(
    () => (top ? getQualityDetail(table, top.name, top.signature, location) : null),
    [top, table, location],
  );

  const hasScanRegion = regions.some((r) => r.role === 'scanResult' && r.enabled);
  const hasRsRegion = regions.some((r) => r.role === 'rs' && r.enabled);

  const overlayStatus: OverlayStatus = deriveOverlayStatus({
    sourceLost,
    paused,
    readState,
    stableRs,
    matchCount: matches.length,
    hasScanRegion,
    hasFrozenScan: !!frozenScan,
    rawRs: readout.rs,
  });

  // Only push OCR stats to the overlay when its toggle is on — otherwise this is
  // null and stable, so the send effect doesn't re-fire every tick.
  const ocrPush = overlayConfig.showOcrStats ? readout.ocr : null;

  // Push matches + top-candidate quality + the frozen rock to the overlay boxes.
  useEffect(() => {
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

  // Global-hotkey commands relayed from main. Recalibrate clears the regions AND
  // the frozen scan so the next rock takes over.
  useEffect(() => {
    return window.sco?.onCommand?.((command) => {
      if (command === 'pause') togglePause();
      else if (command === 'recalibrate') {
        onRegionsChange([]);
        recalibrate();
      }
    });
  }, [onRegionsChange, togglePause, recalibrate]);

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

  // ---- Status-bar + header derivations ------------------------------------
  const voterMeta =
    !paused && !sourceLost && settling && overlayStatus === 'ok'
      ? { label: 'settling', color: '#fbbf24' }
      : STATUS_META[overlayStatus];
  const confPct = readout.ocr ? Math.round(readout.ocr.score * 100) : null;
  const capturing = !paused && !sourceLost && tickRate > 0;
  const health = deriveHealth({ sourceLost, paused, hasRsRegion, capturing, confPct });
  const healthTip =
    `source ${sourceLost ? '✗ lost' : '✓'} · RS region ${hasRsRegion ? '✓' : '✗'} · ` +
    `reads ${capturing ? '✓' : '✗'} · conf ${confPct != null ? `${confPct}%` : '—'}`;

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
        <Button variant="secondary" size="sm" onClick={togglePause}>
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
          <ProspectResults
            stableRs={stableRs}
            matches={matches}
            paused={paused}
            intervalMs={params.intervalMs}
            quorum={params.quorum}
            location={location}
            enforceCluster={enforceCluster}
          />
          <ProspectSettings
            source={source}
            onBack={onBack}
            regions={regions}
            onRegionsChange={onRegionsChange}
            activeId={activeId}
            onActiveChange={setActiveId}
            debugRegions={readout.regions}
            params={params}
            onParamsChange={onParamsChange}
            ocrBackend={ocrBackend}
            effectiveBackend={effectiveBackend}
            onOcrBackendChange={onOcrBackendChange}
            table={table}
            patches={patches}
            activePatch={activePatch}
            onPatchChange={onPatchChange}
            location={location}
            onLocationChange={onLocationChange}
            systemGroups={systemGroups}
            enforceCluster={enforceCluster}
            onEnforceClusterChange={onEnforceClusterChange}
            noiseSignatures={noiseSignatures}
            onNoiseSignaturesChange={onNoiseSignaturesChange}
            overlayConfig={overlayConfig}
            onOverlayConfigChange={onOverlayConfigChange}
            overlayCandidates={overlayCandidates}
            detail={detail}
            overlayStatus={overlayStatus}
            ocr={readout.ocr}
            hotkeys={hotkeys}
            hotkeyStatus={hotkeyStatus}
            onHotkeysChange={onHotkeysChange}
            onReRunSetup={onSetup}
          />
        </div>
      </div>

      <ProspectStatusBar
        stableRs={stableRs}
        voterLabel={voterMeta.label}
        voterColor={voterMeta.color}
        tickRate={tickRate}
        paused={paused}
        ocr={readout.ocr}
        effectiveBackend={effectiveBackend}
      />
    </div>
  );
}

// Control window root. Settings (capture source, region, location, tuning,
// active patch) persist to Electron userData and are restored on launch. The
// signature tables for every crawled patch are bundled and switchable.

import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SignatureTable } from '../core';
import { loadSignatureTable } from '../core';
import type {
  HotkeyAction,
  HotkeyMap,
  OverlayConfig,
  SurveyRegionSetting,
  UpdateInfo,
} from '../shared/bridge';
import { DEFAULT_HOTKEYS, DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import { newRegionId } from './components/roles';
import type { SetupResult } from './components/SetupWizard';
import { SetupWizard } from './components/SetupWizard';
import type { PickedSource } from './components/SourcePicker';
import { SourcePicker } from './components/SourcePicker';
import { SurveyView } from './components/SurveyView';
import type { OcrBackend } from './ocr';
import { getEffectiveBackend, setOcrBackend } from './ocr';
import { ProspectView } from './prospect/ProspectView';
import { Button } from './ui';
import { cn } from './ui/cn';
import type { LoopParams } from './useCaptureLoop';

type Tab = 'mining' | 'survey';

// PP-OCR reads raw color text and localizes it, so there is nothing to tune but
// the crop upscale and the loop cadence.
const DEFAULT_PARAMS: LoopParams = { scale: 4, intervalMs: 700, quorum: 3, minConfidence: 0.5 };

/**
 * Default non-ore signatures to try subtracting from the RS before matching.
 * Empty by default: real values are game-specific and we don't have a verified
 * list. The user populates this from the Mining → "Noise signatures" panel
 * with values they've observed in-game; sub-sums and multiples are then tried
 * automatically (see `matchWithNoise`).
 */
const DEFAULT_NOISE_SIGNATURES: number[] = [];

// All crawled patch tables, bundled at build time → { patch: table }.
const tableModules = import.meta.glob('../data/tables/*.json', { eager: true, import: 'default' });
function loadTables(): Record<string, SignatureTable> {
  const out: Record<string, SignatureTable> = {};
  for (const mod of Object.values(tableModules)) {
    const table = loadSignatureTable(mod);
    out[table.patch] = table;
  }
  return out;
}

export function App() {
  const tables = useMemo(loadTables, []);
  const patches = useMemo(() => Object.keys(tables).sort(), [tables]);

  const [source, setSource] = useState<PickedSource | null>(null);
  const [miningRegions, setMiningRegions] = useState<SurveyRegionSetting[]>([]);
  const [noiseSignatures, setNoiseSignatures] = useState<number[]>(DEFAULT_NOISE_SIGNATURES);
  const [enforceCluster, setEnforceCluster] = useState<boolean>(true);
  const [location, setLocation] = useState<string | null>(null);
  const [params, setParams] = useState<LoopParams>(DEFAULT_PARAMS);
  const [activePatch, setActivePatch] = useState<string>(() => patches[0] ?? 'unknown');
  const [loaded, setLoaded] = useState(false);
  const [hotkeys, setHotkeys] = useState<HotkeyMap>(DEFAULT_HOTKEYS);
  const [hotkeyStatus, setHotkeyStatus] = useState<Partial<Record<HotkeyAction, boolean>>>({});
  const [overlayConfig, setOverlayConfig] = useState<OverlayConfig>(DEFAULT_OVERLAY_CONFIG);
  const [autoReconnect, setAutoReconnect] = useState(true);
  // OCR backend the user selected, and the one actually serving reads (directml
  // silently falls back to wasm if the native host can't start).
  const [ocrBackend, setOcrBackendState] = useState<OcrBackend>('directml');
  const [effectiveBackend, setEffectiveBackend] = useState<OcrBackend | null>(null);
  const [tab, setTab] = useState<Tab>('mining');
  // Survey is gated behind a feature flag (off by default). Code stays; the tab
  // just doesn't render unless enabled. See AppSettings.features.survey.
  const [surveyEnabled, setSurveyEnabled] = useState(false);
  const [surveyRegions, setSurveyRegions] = useState<SurveyRegionSetting[]>([]);
  const [surveyScout, setSurveyScout] = useState<string>('');
  // First-run wizard: shown (after the source pick) until setup is completed or
  // skipped. Decided once on restore; re-openable from the Mining panel.
  const [showWizard, setShowWizard] = useState(false);
  // Update banner: the result of the startup GitHub-Releases check, and the tag
  // the user already dismissed (so the same version doesn't nag every launch).
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissedUpdate, setDismissedUpdate] = useState<string | undefined>(undefined);
  const lastSource = useRef<{ id?: string; name?: string }>({});

  // Restore persisted settings once (Electron userData).
  useEffect(() => {
    let alive = true;
    const finish = (): void => {
      if (alive) setLoaded(true);
    };
    const resolveEffective = (): void => {
      void getEffectiveBackend().then((e) => {
        if (alive) setEffectiveBackend(e);
      });
    };
    const pending = window.sco?.getSettings?.();
    if (!pending) {
      setOcrBackend('directml'); // no persistence → default, auto-falls back to wasm
      resolveEffective();
      setShowWizard(true); // no persistence → treat as a fresh first run
      finish();
      return;
    }
    void pending
      .then((s) => {
        if (!alive || !s) return;
        // Pick the OCR backend before any capture starts. Default DirectML (GPU,
        // vendor-agnostic); it auto-falls back to the WASM worker if the native
        // host can't start, so non-DX12 machines stay safe.
        const backend = s.ocrBackend ?? 'directml';
        setOcrBackendState(backend);
        setOcrBackend(backend);
        resolveEffective();
        if (s.mining?.regions) setMiningRegions(s.mining.regions);
        else if (s.region) {
          // Migrate the legacy single RS region to the new region list.
          setMiningRegions([{ id: newRegionId(), role: 'rs', rect: s.region, enabled: true }]);
        }
        if (s.mining?.noiseSignatures) setNoiseSignatures(s.mining.noiseSignatures);
        if (typeof s.mining?.enforceCluster === 'boolean')
          setEnforceCluster(s.mining.enforceCluster);
        if (s.location != null) setLocation(s.location);
        setParams((prev) => ({
          scale: s.scale ?? prev.scale,
          intervalMs: s.intervalMs ?? prev.intervalMs,
          quorum: s.quorum ?? prev.quorum,
          minConfidence: s.minConfidence ?? prev.minConfidence,
        }));
        if (s.activePatch && tables[s.activePatch]) setActivePatch(s.activePatch);
        if (s.hotkeys) setHotkeys({ ...DEFAULT_HOTKEYS, ...s.hotkeys });
        setOverlayConfig({ ...DEFAULT_OVERLAY_CONFIG, ...(s.overlay ?? {}) });
        if (s.survey?.regions) setSurveyRegions(s.survey.regions);
        if (s.survey?.scout) setSurveyScout(s.survey.scout);
        if (typeof s.features?.survey === 'boolean') setSurveyEnabled(s.features.survey);
        if (s.dismissedUpdate) setDismissedUpdate(s.dismissedUpdate);
        // Show the wizard only for a genuinely fresh profile: not yet completed
        // and no existing regions (so current users skip straight to the panel).
        const hasRegions = !!(s.mining?.regions?.length || s.region);
        setShowWizard(!(s.setupComplete === true || hasRegions));
        lastSource.current = { id: s.sourceId, name: s.sourceName };
      })
      .finally(finish);
    return () => {
      alive = false;
    };
  }, [tables]);

  // Persist changes after the initial restore.
  useEffect(() => {
    if (loaded) {
      window.sco?.setSettings?.({
        mining: { regions: miningRegions, noiseSignatures, enforceCluster },
      });
    }
  }, [miningRegions, noiseSignatures, enforceCluster, loaded]);
  useEffect(() => {
    if (loaded) window.sco?.setSettings?.({ location: location ?? null });
  }, [location, loaded]);
  useEffect(() => {
    if (loaded) {
      window.sco?.setSettings?.({
        scale: params.scale,
        intervalMs: params.intervalMs,
        quorum: params.quorum,
        minConfidence: params.minConfidence,
      });
    }
  }, [params, loaded]);
  useEffect(() => {
    if (loaded) window.sco?.setSettings?.({ activePatch });
  }, [activePatch, loaded]);
  useEffect(() => {
    if (loaded)
      window.sco?.setSettings?.({ survey: { regions: surveyRegions, scout: surveyScout } });
  }, [surveyRegions, surveyScout, loaded]);

  const handlePick = (picked: PickedSource): void => {
    setAutoReconnect(false);
    setSource(picked);
    if (picked.kind === 'desktop') {
      // Remember it so a one-click reconnect (after source loss) can re-select it.
      lastSource.current = { id: picked.sourceId, name: picked.label };
      window.sco?.setSettings?.({ sourceId: picked.sourceId, sourceName: picked.label });
    }
  };

  // Source-lost reconnect: drop back to the picker but keep auto-reconnect armed
  // so it re-selects the same source as soon as it reappears (D1).
  const handleReconnect = (): void => {
    setAutoReconnect(true);
    source?.stream?.getTracks().forEach((t) => {
      t.stop();
    });
    setSource(null);
  };

  const handleHotkeys = async (map: HotkeyMap): Promise<void> => {
    setHotkeys(map);
    const results = await window.sco?.setHotkeys?.(map);
    if (results) setHotkeyStatus(results);
  };

  const handleOcrBackend = (backend: OcrBackend): void => {
    setOcrBackendState(backend);
    setOcrBackend(backend);
    window.sco?.setSettings?.({ ocrBackend: backend });
    void getEffectiveBackend().then(setEffectiveBackend);
  };

  const handleOverlayConfig = (cfg: OverlayConfig): void => {
    setOverlayConfig(cfg);
    window.sco?.setOverlayConfig?.(cfg);
  };

  // Config can also change from the overlay side (e.g. sorting the scanned-rock
  // card in edit mode); main echoes every change here. Update state only — do
  // NOT re-send, or it would loop.
  useEffect(() => {
    return window.sco?.onOverlayConfig?.((cfg) => setOverlayConfig(cfg));
  }, []);

  // One-shot update check once settings are restored (so dismissedUpdate is
  // known). Failures resolve to a non-available result; the banner just hides.
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    void window.sco?.checkForUpdates?.().then((info) => {
      if (alive) setUpdate(info ?? null);
    });
    return () => {
      alive = false;
    };
  }, [loaded]);

  const dismissUpdate = (): void => {
    const tag = update?.latest ?? undefined;
    setDismissedUpdate(tag);
    if (tag) window.sco?.setSettings?.({ dismissedUpdate: tag });
  };

  const handleBack = (): void => {
    setAutoReconnect(false); // explicit "← Sources" — don't auto-reconnect again
    source?.stream?.getTracks().forEach((t) => {
      t.stop();
    });
    if (source?.imageUrl) URL.revokeObjectURL(source.imageUrl);
    if (source?.videoUrl) URL.revokeObjectURL(source.videoUrl);
    setSource(null);
  };

  const completeSetup = (result: SetupResult): void => {
    // Replace just the RS / scanResult regions the wizard set; keep any others
    // the user already had, so re-running setup isn't destructive. A skipped
    // step leaves its region null → that role is left untouched.
    setMiningRegions((prev) => {
      let regions = prev;
      if (result.rsRegion) regions = [result.rsRegion, ...regions.filter((r) => r.role !== 'rs')];
      if (result.scanRegion)
        regions = [...regions.filter((r) => r.role !== 'scanResult'), result.scanRegion];
      return regions;
    });
    setLocation(result.location);
    if (result.overlayPreset) handleOverlayConfig({ ...overlayConfig, ...result.overlayPreset });
    setShowWizard(false);
    window.sco?.setSettings?.({ setupComplete: true });
  };

  const skipSetup = (): void => {
    setShowWizard(false);
    window.sco?.setSettings?.({ setupComplete: true });
  };

  const table = tables[activePatch] ?? tables[patches[0] ?? ''];

  if (!loaded) return null;
  if (!table) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-bold">No signature table</h1>
        <p className="mt-2 text-sm text-muted">
          Run <code className="rounded-sm bg-bg px-1 py-0.5 font-mono">npm run crawl</code> to
          generate one under{' '}
          <code className="rounded-sm bg-bg px-1 py-0.5 font-mono">src/data/tables/</code>.
        </p>
      </main>
    );
  }
  // The wizard owns the Source step, so it renders before the standalone picker:
  // a fresh profile lands on Welcome and picks its source inside the flow.
  if (showWizard) {
    return (
      <SetupWizard
        source={source}
        onPickSource={handlePick}
        lastSourceId={autoReconnect ? lastSource.current.id : undefined}
        table={table}
        onComplete={completeSetup}
        onSkip={skipSetup}
        onExit={skipSetup}
      />
    );
  }
  if (!source) {
    return (
      <SourcePicker
        onPick={handlePick}
        lastSourceId={autoReconnect ? lastSource.current.id : undefined}
      />
    );
  }
  // With Survey gated off, Mining is the only view — force it and drop the
  // tab bar entirely (no orphan single tab).
  const activeTab: Tab = surveyEnabled ? tab : 'mining';
  const showUpdate = !!update?.available && update.latest !== dismissedUpdate;
  return (
    <div className="flex h-screen flex-col">
      {showUpdate && update && (
        <div className="flex items-center gap-2.5 border-b border-accent bg-[#13282b] px-3 py-2 text-[13px] text-[#d7e3e6]">
          <span className="flex-1">
            Update available: <strong>{update.latest}</strong>
            <span className="text-muted"> (you have v{update.current})</span>
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => window.sco?.openExternal?.(update.url)}
          >
            Download
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted"
            onClick={dismissUpdate}
            aria-label="Dismiss update notice"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      {surveyEnabled && (
        <nav className="flex gap-0.5 border-b border-border bg-surface-alt px-2.5 pt-1.5">
          {(['mining', 'survey'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={cn(
                'rounded-t-md border border-transparent px-4 py-1.5 text-[13px] capitalize transition-colors',
                activeTab === t
                  ? 'border-border border-b-surface bg-surface text-fg'
                  : 'text-muted hover:text-fg',
              )}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
      )}
      <div className="min-h-0 flex-1">
        {activeTab === 'mining' ? (
          <ProspectView
            source={source}
            regions={miningRegions}
            onRegionsChange={setMiningRegions}
            noiseSignatures={noiseSignatures}
            onNoiseSignaturesChange={setNoiseSignatures}
            enforceCluster={enforceCluster}
            onEnforceClusterChange={setEnforceCluster}
            params={params}
            onParamsChange={setParams}
            ocrBackend={ocrBackend}
            effectiveBackend={effectiveBackend}
            onOcrBackendChange={handleOcrBackend}
            table={table}
            location={location}
            onLocationChange={setLocation}
            patches={patches}
            activePatch={activePatch}
            onPatchChange={setActivePatch}
            hotkeys={hotkeys}
            hotkeyStatus={hotkeyStatus}
            onHotkeysChange={handleHotkeys}
            overlayConfig={overlayConfig}
            onOverlayConfigChange={handleOverlayConfig}
            onBack={handleBack}
            onReconnect={handleReconnect}
            onSetup={() => setShowWizard(true)}
          />
        ) : (
          <SurveyView
            source={source}
            table={table}
            params={params}
            regions={surveyRegions}
            onRegionsChange={setSurveyRegions}
            scout={surveyScout}
            onScoutChange={setSurveyScout}
            onBack={handleBack}
          />
        )}
      </div>
    </div>
  );
}

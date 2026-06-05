// Control window root. Settings (capture source, region, location, tuning,
// active patch) persist to Electron userData and are restored on launch. The
// signature tables for every crawled patch are bundled and switchable.

import type { CSSProperties } from 'react';
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
import { ScanView } from './components/ScanView';
import { SetupWizard } from './components/SetupWizard';
import type { PickedSource } from './components/SourcePicker';
import { SourcePicker } from './components/SourcePicker';
import { SurveyView } from './components/SurveyView';
import type { OcrBackend } from './ocr';
import { getEffectiveBackend, setOcrBackend } from './ocr';
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

  const completeSetup = (region: SurveyRegionSetting, loc: string | null): void => {
    // Replace just the RS region; keep any other regions (e.g. scanResult) the
    // user added, so re-running setup isn't destructive.
    setMiningRegions((prev) => [region, ...prev.filter((r) => r.role !== 'rs')]);
    setLocation(loc);
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
      <main style={{ padding: 24, color: '#e6e6e6' }}>
        <h1>No signature table</h1>
        <p>
          Run <code>npm run crawl</code> to generate one under <code>src/data/tables/</code>.
        </p>
      </main>
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
  if (showWizard) {
    return (
      <SetupWizard
        source={source}
        table={table}
        onComplete={completeSetup}
        onSkip={skipSetup}
        onBack={handleBack}
      />
    );
  }
  // With Survey gated off, Mining is the only view — force it and drop the
  // tab bar entirely (no orphan single tab).
  const activeTab: Tab = surveyEnabled ? tab : 'mining';
  const showUpdate = !!update?.available && update.latest !== dismissedUpdate;
  return (
    <div style={shell.root}>
      {showUpdate && update && (
        <div style={shell.banner}>
          <span style={{ flex: 1 }}>
            Update available: <strong>{update.latest}</strong>
            <span style={{ color: '#7d8a99' }}> (you have v{update.current})</span>
          </span>
          <button
            type="button"
            style={shell.bannerLink}
            onClick={() => window.sco?.openExternal?.(update.url)}
          >
            Download
          </button>
          <button
            type="button"
            style={shell.bannerDismiss}
            onClick={dismissUpdate}
            aria-label="Dismiss update notice"
          >
            ×
          </button>
        </div>
      )}
      {surveyEnabled && (
        <nav style={shell.tabs}>
          <button
            type="button"
            style={{ ...shell.tab, ...(activeTab === 'mining' ? shell.tabActive : null) }}
            onClick={() => setTab('mining')}
          >
            Mining
          </button>
          <button
            type="button"
            style={{ ...shell.tab, ...(activeTab === 'survey' ? shell.tabActive : null) }}
            onClick={() => setTab('survey')}
          >
            Survey
          </button>
        </nav>
      )}
      <div style={shell.view}>
        {activeTab === 'mining' ? (
          <ScanView
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

const shell: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100vh' },
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    background: '#13282b',
    borderBottom: '1px solid #1FD0D8',
    color: '#d7e3e6',
    fontSize: 13,
  },
  bannerLink: {
    background: '#1FD0D8',
    color: '#06222a',
    border: 'none',
    borderRadius: 6,
    padding: '5px 12px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  },
  bannerDismiss: {
    background: 'none',
    color: '#9fb3c8',
    border: 'none',
    fontSize: 18,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0 4px',
  },
  tabs: {
    display: 'flex',
    gap: 2,
    padding: '6px 10px 0',
    background: '#16181d',
    borderBottom: '1px solid #2c323d',
  },
  tab: {
    background: 'none',
    color: '#9fb3c8',
    border: '1px solid transparent',
    borderBottom: 'none',
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    padding: '7px 16px',
    cursor: 'pointer',
    fontSize: 13,
  },
  tabActive: {
    background: '#1d2128',
    color: '#e6e6e6',
    border: '1px solid #2c323d',
    borderBottom: '1px solid #1d2128',
  },
  view: { flex: 1, minHeight: 0 },
};

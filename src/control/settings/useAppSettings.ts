// The control window's persisted-settings layer. Owns every value restored from
// (and saved to) Electron userData, the one-time restore, the consolidated
// persistence, and the setters whose side-effects aren't a plain setSettings
// (hotkey registration, overlay-config IPC + echo, OCR-backend choice, the
// remembered source). App composes this with useOcrEngine + useUpdateCheck and is
// left with routing + layout.
//
// The single getSettings() call lives here; other hooks take the values they
// need as params, so settings are never read twice.

import { useEffect, useRef, useState } from 'react';
import type { SignatureTable } from '../../core';
import type {
  HotkeyAction,
  HotkeyMap,
  OverlayConfig,
  SurveyRegionSetting,
} from '../../shared/bridge';
import { DEFAULT_HOTKEYS, DEFAULT_OVERLAY_CONFIG } from '../../shared/bridge';
import { newRegionId } from '../components/roles';
import type { OcrBackend } from '../ocr';
import type { LoopParams } from '../useCaptureLoop';

// PP-OCR reads raw color text and localizes it, so there is nothing to tune but
// the crop upscale and the loop cadence.
const DEFAULT_PARAMS: LoopParams = { scale: 4, intervalMs: 700, quorum: 3, minConfidence: 0.5 };

// Empty by default: real noise values are game-specific; the user populates them.
const DEFAULT_NOISE_SIGNATURES: number[] = [];

export function useAppSettings(tables: Record<string, SignatureTable>) {
  const patches = Object.keys(tables).sort();

  const [miningRegions, setMiningRegions] = useState<SurveyRegionSetting[]>([]);
  const [noiseSignatures, setNoiseSignatures] = useState<number[]>(DEFAULT_NOISE_SIGNATURES);
  const [enforceCluster, setEnforceCluster] = useState<boolean>(true);
  const [location, setLocation] = useState<string | null>(null);
  const [params, setParams] = useState<LoopParams>(DEFAULT_PARAMS);
  const [activePatch, setActivePatch] = useState<string>(() => patches[0] ?? 'unknown');
  const [loaded, setLoaded] = useState(false);
  const [hotkeys, setHotkeysState] = useState<HotkeyMap>(DEFAULT_HOTKEYS);
  const [hotkeyStatus, setHotkeyStatus] = useState<Partial<Record<HotkeyAction, boolean>>>({});
  const [overlayConfig, setOverlayConfigState] = useState<OverlayConfig>(DEFAULT_OVERLAY_CONFIG);
  const [ocrBackend, setOcrBackendState] = useState<OcrBackend>('directml');
  const [surveyEnabled, setSurveyEnabled] = useState(false);
  const [surveyRegions, setSurveyRegions] = useState<SurveyRegionSetting[]>([]);
  const [surveyScout, setSurveyScout] = useState<string>('');
  const [dismissedUpdate, setDismissedUpdateState] = useState<string | undefined>(undefined);
  // Whether the first-run wizard should open (decided once on restore).
  const [initialShowWizard, setInitialShowWizard] = useState(false);
  // The remembered desktop source for one-click reconnect after a source loss.
  const lastSource = useRef<{ id?: string; name?: string }>({});

  // Restore persisted settings once (Electron userData).
  // biome-ignore lint/correctness/useExhaustiveDependencies: restore once; `tables` only validates the saved activePatch.
  useEffect(() => {
    let alive = true;
    const finish = (): void => {
      if (alive) setLoaded(true);
    };
    const pending = window.sco?.getSettings?.();
    if (!pending) {
      setInitialShowWizard(true); // no persistence → treat as a fresh first run
      finish();
      return;
    }
    void pending
      .then((s) => {
        if (!alive || !s) return;
        if (s.ocrBackend) setOcrBackendState(s.ocrBackend);
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
        if (s.hotkeys) setHotkeysState({ ...DEFAULT_HOTKEYS, ...s.hotkeys });
        setOverlayConfigState({ ...DEFAULT_OVERLAY_CONFIG, ...(s.overlay ?? {}) });
        if (s.survey?.regions) setSurveyRegions(s.survey.regions);
        if (s.survey?.scout) setSurveyScout(s.survey.scout);
        if (typeof s.features?.survey === 'boolean') setSurveyEnabled(s.features.survey);
        if (s.dismissedUpdate) setDismissedUpdateState(s.dismissedUpdate);
        // Open the wizard only for a genuinely fresh profile: not yet completed
        // and no existing regions (so current users skip straight to the panel).
        const hasRegions = !!(s.mining?.regions?.length || s.region);
        setInitialShowWizard(!(s.setupComplete === true || hasRegions));
        lastSource.current = { id: s.sourceId, name: s.sourceName };
      })
      .finally(finish);
    return () => {
      alive = false;
    };
  }, []);

  // Persist changes after the initial restore. One effect per IPC slice.
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
    if (loaded) {
      window.sco?.setSettings?.({ survey: { regions: surveyRegions, scout: surveyScout } });
    }
  }, [surveyRegions, surveyScout, loaded]);

  // Overlay config can also change from the overlay side (e.g. sorting the
  // scanned-rock card in edit mode); main echoes every change here. Update state
  // only — do NOT re-send, or it would loop.
  useEffect(() => {
    return window.sco?.onOverlayConfig?.((cfg) => setOverlayConfigState(cfg));
  }, []);

  // --- Setters with side-effects beyond a plain setSettings ----------------

  const setHotkeys = async (map: HotkeyMap): Promise<void> => {
    setHotkeysState(map);
    const results = await window.sco?.setHotkeys?.(map);
    if (results) setHotkeyStatus(results);
  };

  const setOcrBackend = (backend: OcrBackend): void => {
    setOcrBackendState(backend);
    window.sco?.setSettings?.({ ocrBackend: backend });
  };

  const setOverlayConfig = (cfg: OverlayConfig): void => {
    setOverlayConfigState(cfg);
    window.sco?.setOverlayConfig?.(cfg);
  };

  const setDismissedUpdate = (tag: string | undefined): void => {
    setDismissedUpdateState(tag);
    if (tag) window.sco?.setSettings?.({ dismissedUpdate: tag });
  };

  const markSetupComplete = (): void => {
    window.sco?.setSettings?.({ setupComplete: true });
  };

  const rememberSource = (id: string, name: string): void => {
    lastSource.current = { id, name };
    window.sco?.setSettings?.({ sourceId: id, sourceName: name });
  };

  return {
    loaded,
    initialShowWizard,
    lastSource,
    // values
    miningRegions,
    noiseSignatures,
    enforceCluster,
    location,
    params,
    activePatch,
    hotkeys,
    hotkeyStatus,
    overlayConfig,
    ocrBackend,
    surveyEnabled,
    surveyRegions,
    surveyScout,
    dismissedUpdate,
    // setters
    setMiningRegions,
    setNoiseSignatures,
    setEnforceCluster,
    setLocation,
    setParams,
    setActivePatch,
    setHotkeys,
    setOcrBackend,
    setOverlayConfig,
    setSurveyRegions,
    setSurveyScout,
    setDismissedUpdate,
    markSetupComplete,
    rememberSource,
  };
}

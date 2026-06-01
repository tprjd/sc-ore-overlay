// Control window root. Settings (capture source, region, location, tuning,
// active patch) persist to Electron userData and are restored on launch. The
// signature tables for every crawled patch are bundled and switchable.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { SourcePicker } from './components/SourcePicker';
import type { PickedSource } from './components/SourcePicker';
import { ScanView } from './components/ScanView';
import { SurveyView } from './components/SurveyView';
import { newRegionId } from './components/roles';
import type { LoopParams } from './useCaptureLoop';
import { loadSignatureTable } from '../core';
import type { SignatureTable } from '../core';
import { DEFAULT_HOTKEYS, DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import type {
  HotkeyAction,
  HotkeyMap,
  OverlayConfig,
  SurveyRegionSetting,
} from '../shared/bridge';

type Tab = 'mining' | 'survey';

// PP-OCR reads raw color text and localizes it, so there is nothing to tune but
// the crop upscale and the loop cadence.
const DEFAULT_PARAMS: LoopParams = { scale: 4, intervalMs: 700, quorum: 3 };

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
  const [location, setLocation] = useState<string | null>(null);
  const [params, setParams] = useState<LoopParams>(DEFAULT_PARAMS);
  const [activePatch, setActivePatch] = useState<string>(() => patches[0] ?? 'unknown');
  const [loaded, setLoaded] = useState(false);
  const [hotkeys, setHotkeys] = useState<HotkeyMap>(DEFAULT_HOTKEYS);
  const [hotkeyStatus, setHotkeyStatus] = useState<Partial<Record<HotkeyAction, boolean>>>({});
  const [overlayConfig, setOverlayConfig] = useState<OverlayConfig>(DEFAULT_OVERLAY_CONFIG);
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [tab, setTab] = useState<Tab>('mining');
  const [surveyRegions, setSurveyRegions] = useState<SurveyRegionSetting[]>([]);
  const [surveyScout, setSurveyScout] = useState<string>('');
  const lastSource = useRef<{ id?: string; name?: string }>({});

  // Restore persisted settings once (Electron userData).
  useEffect(() => {
    let alive = true;
    const finish = (): void => {
      if (alive) setLoaded(true);
    };
    const pending = window.sco?.getSettings?.();
    if (!pending) {
      finish();
      return;
    }
    void pending
      .then((s) => {
        if (!alive || !s) return;
        if (s.mining?.regions) setMiningRegions(s.mining.regions);
        else if (s.region) {
          // Migrate the legacy single RS region to the new region list.
          setMiningRegions([{ id: newRegionId(), role: 'rs', rect: s.region, enabled: true }]);
        }
        if (s.mining?.noiseSignatures) setNoiseSignatures(s.mining.noiseSignatures);
        if (s.location != null) setLocation(s.location);
        setParams((prev) => ({
          scale: s.scale ?? prev.scale,
          intervalMs: s.intervalMs ?? prev.intervalMs,
          quorum: s.quorum ?? prev.quorum,
        }));
        if (s.activePatch && tables[s.activePatch]) setActivePatch(s.activePatch);
        if (s.hotkeys) setHotkeys({ ...DEFAULT_HOTKEYS, ...s.hotkeys });
        setOverlayConfig({ ...DEFAULT_OVERLAY_CONFIG, ...(s.overlay ?? {}) });
        if (s.survey?.regions) setSurveyRegions(s.survey.regions);
        if (s.survey?.scout) setSurveyScout(s.survey.scout);
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
        mining: { regions: miningRegions, noiseSignatures },
      });
    }
  }, [miningRegions, noiseSignatures, loaded]);
  useEffect(() => {
    if (loaded) window.sco?.setSettings?.({ location: location ?? null });
  }, [location, loaded]);
  useEffect(() => {
    if (loaded) {
      window.sco?.setSettings?.({
        scale: params.scale,
        intervalMs: params.intervalMs,
        quorum: params.quorum,
      });
    }
  }, [params, loaded]);
  useEffect(() => {
    if (loaded) window.sco?.setSettings?.({ activePatch });
  }, [activePatch, loaded]);
  useEffect(() => {
    if (loaded) window.sco?.setSettings?.({ survey: { regions: surveyRegions, scout: surveyScout } });
  }, [surveyRegions, surveyScout, loaded]);

  const handlePick = (picked: PickedSource): void => {
    setAutoReconnect(false);
    setSource(picked);
    if (picked.kind === 'desktop') {
      window.sco?.setSettings?.({ sourceId: picked.sourceId, sourceName: picked.label });
    }
  };

  const handleHotkeys = async (map: HotkeyMap): Promise<void> => {
    setHotkeys(map);
    const results = await window.sco?.setHotkeys?.(map);
    if (results) setHotkeyStatus(results);
  };

  const handleOverlayConfig = (cfg: OverlayConfig): void => {
    setOverlayConfig(cfg);
    window.sco?.setOverlayConfig?.(cfg);
  };

  const handleBack = (): void => {
    setAutoReconnect(false); // explicit "← Sources" — don't auto-reconnect again
    source?.stream?.getTracks().forEach((t) => t.stop());
    if (source?.imageUrl) URL.revokeObjectURL(source.imageUrl);
    setSource(null);
  };

  const table = tables[activePatch] ?? tables[patches[0] ?? ''];

  if (!loaded) return null;
  if (!table) {
    return (
      <main style={{ padding: 24, color: '#e6e6e6' }}>
        <h1>No signature table</h1>
        <p>Run <code>npm run crawl</code> to generate one under <code>src/data/tables/</code>.</p>
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
  return (
    <div style={shell.root}>
      <nav style={shell.tabs}>
        <button
          style={{ ...shell.tab, ...(tab === 'mining' ? shell.tabActive : null) }}
          onClick={() => setTab('mining')}
        >
          Mining
        </button>
        <button
          style={{ ...shell.tab, ...(tab === 'survey' ? shell.tabActive : null) }}
          onClick={() => setTab('survey')}
        >
          Survey
        </button>
      </nav>
      <div style={shell.view}>
        {tab === 'mining' ? (
          <ScanView
            source={source}
            regions={miningRegions}
            onRegionsChange={setMiningRegions}
            noiseSignatures={noiseSignatures}
            onNoiseSignaturesChange={setNoiseSignatures}
            params={params}
            onParamsChange={setParams}
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
  tabs: { display: 'flex', gap: 2, padding: '6px 10px 0', background: '#16181d', borderBottom: '1px solid #2c323d' },
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
  tabActive: { background: '#1d2128', color: '#e6e6e6', border: '1px solid #2c323d', borderBottom: '1px solid #1d2128' },
  view: { flex: 1, minHeight: 0 },
};

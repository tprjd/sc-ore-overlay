// Control window root. Settings (capture source, region, location, tuning,
// active patch) persist to Electron userData and are restored on launch. The
// signature tables for every crawled patch are bundled and switchable.

import { useEffect, useMemo, useRef, useState } from 'react';

import { SourcePicker } from './components/SourcePicker';
import type { PickedSource } from './components/SourcePicker';
import { ScanView } from './components/ScanView';
import type { NormRegion } from './preprocess';
import type { LoopParams } from './useCaptureLoop';
import { loadSignatureTable } from '../core';
import type { SignatureTable } from '../core';
import { DEFAULT_HOTKEYS, DEFAULT_OVERLAY_CONFIG } from '../shared/bridge';
import type { HotkeyAction, HotkeyMap, OverlayConfig } from '../shared/bridge';

// PP-OCR reads raw color text and localizes it, so there is nothing to tune but
// the crop upscale and the loop cadence.
const DEFAULT_PARAMS: LoopParams = { scale: 3, intervalMs: 700, quorum: 3 };

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
  const [region, setRegion] = useState<NormRegion | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [params, setParams] = useState<LoopParams>(DEFAULT_PARAMS);
  const [activePatch, setActivePatch] = useState<string>(() => patches[0] ?? 'unknown');
  const [loaded, setLoaded] = useState(false);
  const [hotkeys, setHotkeys] = useState<HotkeyMap>(DEFAULT_HOTKEYS);
  const [hotkeyStatus, setHotkeyStatus] = useState<Partial<Record<HotkeyAction, boolean>>>({});
  const [overlayConfig, setOverlayConfig] = useState<OverlayConfig>(DEFAULT_OVERLAY_CONFIG);
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
        if (s.region) setRegion(s.region);
        if (s.location != null) setLocation(s.location);
        setParams((prev) => ({
          scale: s.scale ?? prev.scale,
          intervalMs: s.intervalMs ?? prev.intervalMs,
          quorum: s.quorum ?? prev.quorum,
        }));
        if (s.activePatch && tables[s.activePatch]) setActivePatch(s.activePatch);
        if (s.hotkeys) setHotkeys({ ...DEFAULT_HOTKEYS, ...s.hotkeys });
        setOverlayConfig({ ...DEFAULT_OVERLAY_CONFIG, ...(s.overlay ?? {}) });
        lastSource.current = { id: s.sourceId, name: s.sourceName };
      })
      .finally(finish);
    return () => {
      alive = false;
    };
  }, [tables]);

  // Persist changes after the initial restore.
  useEffect(() => {
    if (loaded) window.sco?.setSettings?.({ region: region ?? null });
  }, [region, loaded]);
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

  const handlePick = (picked: PickedSource): void => {
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
    return <SourcePicker onPick={handlePick} lastSourceId={lastSource.current.id} />;
  }
  return (
    <ScanView
      source={source}
      region={region}
      onRegionChange={setRegion}
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
  );
}

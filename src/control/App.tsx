// Control window root. Two steps for Phase 1: pick a capture source, then
// calibrate the RS region + tune OCR. Region and tuning params persist to
// localStorage so the human-tuning loop survives reloads. (Phase 4 moves
// persistence to Electron userData; Phase 2 wires the matcher + overlay.)

import { useEffect, useMemo, useState } from 'react';

import { SourcePicker } from './components/SourcePicker';
import type { PickedSource } from './components/SourcePicker';
import { ScanView } from './components/ScanView';
import type { NormRegion } from './preprocess';
import type { LoopParams } from './useCaptureLoop';
import { loadSignatureTable } from '../core';
import signaturesJson from '../data/signatures.json';

// PP-OCR reads raw color text and localizes it, so there is nothing to tune but
// the crop upscale and the loop cadence.
const DEFAULT_PARAMS: LoopParams = {
  scale: 3,
  intervalMs: 700,
  quorum: 3,
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function App() {
  const [source, setSource] = useState<PickedSource | null>(null);
  const [region, setRegion] = useState<NormRegion | null>(() => load('sco.region', null));
  const [params, setParams] = useState<LoopParams>(() => ({
    ...DEFAULT_PARAMS,
    ...load<Partial<LoopParams>>('sco.params', {}),
  }));

  useEffect(() => {
    localStorage.setItem('sco.params', JSON.stringify(params));
  }, [params]);

  useEffect(() => {
    if (region) localStorage.setItem('sco.region', JSON.stringify(region));
    else localStorage.removeItem('sco.region');
  }, [region]);

  const table = useMemo(() => loadSignatureTable(signaturesJson), []);
  const [location, setLocation] = useState<string | null>(() => load('sco.location', null));
  useEffect(() => {
    if (location) localStorage.setItem('sco.location', JSON.stringify(location));
    else localStorage.removeItem('sco.location');
  }, [location]);

  const handleBack = (): void => {
    source?.stream?.getTracks().forEach((t) => t.stop());
    if (source?.imageUrl) URL.revokeObjectURL(source.imageUrl);
    setSource(null);
  };

  if (!source) {
    return <SourcePicker onPick={setSource} />;
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
      onBack={handleBack}
    />
  );
}

// Applies the selected OCR backend to the in-renderer/native core and resolves
// which backend is *actually* serving reads (directml silently falls back to
// wasm if the native host can't start). Reacts to the selected value once
// settings are loaded — the orchestrator just persists the choice; this applies it.

import { useEffect, useState } from 'react';
import type { OcrBackend } from '../ocr';
import { getEffectiveBackend, setOcrBackend } from '../ocr';

export function useOcrEngine(ocrBackend: OcrBackend, loaded: boolean): OcrBackend | null {
  const [effectiveBackend, setEffectiveBackend] = useState<OcrBackend | null>(null);
  useEffect(() => {
    if (!loaded) return;
    // Pick the core backend before any capture starts.
    setOcrBackend(ocrBackend);
    let alive = true;
    void getEffectiveBackend().then((e) => {
      if (alive) setEffectiveBackend(e);
    });
    return () => {
      alive = false;
    };
  }, [ocrBackend, loaded]);
  return effectiveBackend;
}

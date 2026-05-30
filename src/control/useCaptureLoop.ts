// The capture loop as a React hook: every ~intervalMs, crop+upscale the region,
// skip if the crop is unchanged, otherwise PP-OCR detect → pick the digit run
// (bestReading) → validate (plausibility + temporal voting). Returns observable
// state for the debug view.

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { hashPixels } from '../core/image';
import { bestReading } from '../core/parse';
import { isPlausibleReading, createVoter } from '../core/validator';
import { preprocess } from './preprocess';
import type { DrawableSource, NormRegion, PreprocessParams } from './preprocess';
import { recognize } from './ocr';

export interface LoopParams extends PreprocessParams {
  /** Frame sampling period in ms (~500–1000). */
  intervalMs: number;
  /** Consecutive identical reads required before a value is accepted. */
  quorum: number;
}

export interface LoopState {
  /** Latest crop, as a data URL (for the debug view). */
  dataUrl: string | null;
  /** Summary of PP-OCR's detected lines (text + confidence). */
  rawText: string;
  /** The reading chosen from the detections (pre-validation). */
  value: number | null;
  /** Whether `value` passed the plausibility check. */
  plausible: boolean;
  /** The accepted, voter-stable reading (null until quorum is met). */
  stable: number | null;
  /** How many OCR passes have run (skipped frames don't count). */
  ocrRuns: number;
  /** True when the last frame was identical and OCR was skipped. */
  skipped: boolean;
  /** Last error message, if any. */
  error: string | null;
}

const INITIAL: LoopState = {
  dataUrl: null,
  rawText: '',
  value: null,
  plausible: false,
  stable: null,
  ocrRuns: 0,
  skipped: false,
  error: null,
};

/**
 * Run the capture→OCR→validate loop while `enabled` and a `region` are set.
 * The voter resets whenever params change (so tuning starts a fresh streak).
 */
export function useCaptureLoop(
  mediaRef: RefObject<DrawableSource | null>,
  region: NormRegion | null,
  params: LoopParams,
  enabled: boolean,
): LoopState {
  const [state, setState] = useState<LoopState>(INITIAL);
  const busy = useRef(false);
  const lastHash = useRef<number | null>(null);
  const lastValue = useRef<number | null>(null);

  const { scale, intervalMs, quorum } = params;

  useEffect(() => {
    if (!enabled || !region) return;

    const voter = createVoter({ quorum });
    lastHash.current = null;
    lastValue.current = null;
    let cancelled = false;

    const tick = async (): Promise<void> => {
      const media = mediaRef.current;
      if (!media || busy.current) return;

      const pre = preprocess(media, region, { scale });
      if (!pre) return;

      setState((s) => ({ ...s, dataUrl: pre.dataUrl }));

      const hash = hashPixels(pre.pixels);
      if (hash === lastHash.current) {
        // Unchanged frame: skip the expensive OCR, but keep voting the last
        // reading so a static image still reaches quorum and latches.
        const stable = voter.push(lastValue.current);
        setState((s) => ({ ...s, stable, skipped: true }));
        return;
      }
      lastHash.current = hash;

      busy.current = true;
      try {
        const lines = await recognize(pre.dataUrl);
        if (cancelled) return;
        const value = bestReading(lines);
        const plausible = isPlausibleReading(value);
        lastValue.current = plausible ? value : null;
        const stable = voter.push(lastValue.current);
        const rawText = lines.length
          ? lines.map((l) => `${l.text} ${Math.round(l.score * 100)}%`).join(' | ')
          : '(no text)';
        setState((s) => ({
          ...s,
          rawText,
          value,
          plausible,
          stable,
          ocrRuns: s.ocrRuns + 1,
          skipped: false,
          error: null,
        }));
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      } finally {
        busy.current = false;
      }
    };

    const id = window.setInterval(() => void tick(), Math.max(200, intervalMs));
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [mediaRef, region, scale, intervalMs, quorum, enabled]);

  return state;
}

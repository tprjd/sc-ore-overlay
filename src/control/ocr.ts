// OCR client. Two transports behind one stable API (`recognize(dataUrl)`):
//
//  - 'worker'  — PP-OCR on ONNX Runtime Web in a renderer Web Worker
//    (src/control/ocr.worker.ts). Backends: 'wasm' (CPU, default) or 'webgpu'.
//  - 'native'  — PP-OCR on native onnxruntime-node + DirectML in an Electron
//    utility process (electron/ocr-host.ts), reached via the preload bridge
//    (window.sco.ocr*). GPU OCR on any DX12 GPU, with its own D3D12 device so it
//    doesn't contend with the overlay compositor. Selected by backend 'directml'.
//
// The transport is chosen once by setOcrBackend() before capture starts; if the
// native host can't start (or dies mid-session) we fall back to the WASM worker
// transparently. Call sites only ever see recognize() → OcrLine[].

import type { OcrLine } from '../shared/bridge';

export type { OcrLine };

/** OCR execution backend.
 *  - 'wasm'     CPU, in-renderer worker. Never touches the GPU (default).
 *  - 'webgpu'   in-renderer worker on the GPU; can fight the overlay compositor.
 *  - 'directml' native utility process on the GPU (DirectML), no contention. */
export type OcrBackend = 'wasm' | 'webgpu' | 'directml';

interface WorkerResult {
  id: number;
  lines?: OcrLine[];
  error?: string;
}

// --- Web Worker transport (wasm / webgpu) ------------------------------------
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<
  number,
  { resolve: (lines: OcrLine[]) => void; reject: (err: Error) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResult>): void => {
    const { id, lines, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error));
    else p.resolve(lines ?? []);
  };
  worker.onerror = (e: ErrorEvent): void => {
    const err = new Error(e.message || 'OCR worker failed to load');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  return worker;
}

/** Warm the Web Worker with a CPU/GPU backend (must precede the first job). */
function initWorker(backend: 'wasm' | 'webgpu'): void {
  getWorker().postMessage({ type: 'init', backend });
}

function recognizeWorker(imageDataUrl: string): Promise<OcrLine[]> {
  const w = getWorker();
  const id = ++seq;
  return new Promise<OcrLine[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ type: 'recognize', id, dataUrl: imageDataUrl });
  });
}

// --- Transport selection -----------------------------------------------------
// Resolves to the transport recognize() should use. Defaults to the worker so a
// stray early recognize() before setOcrBackend() still works (on WASM).
let transportReady: Promise<'worker' | 'native'> = Promise.resolve('worker');

// The backend the user asked for; the *effective* one can differ (directml that
// fails to start resolves to 'wasm'). getEffectiveBackend() reports the truth.
let selectedBackend: OcrBackend = 'wasm';

/** The backend actually serving reads, after any directml→wasm fallback. */
export function getEffectiveBackend(): Promise<OcrBackend> {
  return transportReady.then((t) => (t === 'native' ? 'directml' : selectedBackend));
}

/** Switch to the WASM worker for the rest of the session (native fell through). */
function fallbackToWasm(reason: unknown): 'worker' {
  console.warn('[ocr] native DirectML host unavailable; falling back to WASM:', reason);
  selectedBackend = 'wasm';
  initWorker('wasm');
  transportReady = Promise.resolve('worker');
  return 'worker';
}

/** Probe the native host; on failure warm + use the WASM worker instead. */
async function probeNative(): Promise<'worker' | 'native'> {
  try {
    if (await window.sco?.ocrAvailable?.()) {
      console.info('[ocr] backend: directml (native utility process)');
      return 'native';
    }
    return fallbackToWasm('host reported unavailable');
  } catch (err) {
    return fallbackToWasm(err);
  }
}

/**
 * Select the OCR backend (and warm the chosen transport). Must be called before
 * the first `recognize()`. 'directml' probes the native host and silently falls
 * back to WASM if it can't start; 'wasm'/'webgpu' use the in-renderer worker.
 */
export function setOcrBackend(backend: OcrBackend): void {
  selectedBackend = backend;
  if (backend === 'directml') {
    transportReady = probeNative();
  } else {
    console.info(`[ocr] backend: ${backend} (renderer worker)`);
    initWorker(backend);
    transportReady = Promise.resolve('worker');
  }
}

/** Spawn/warm the OCR engine ahead of first use. */
export function loadOcr(backend: OcrBackend = 'wasm'): void {
  setOcrBackend(backend);
}

/** Detect + recognize all text lines in a crop given as a PNG data URL. */
export async function recognize(imageDataUrl: string): Promise<OcrLine[]> {
  const transport = await transportReady;
  if (transport === 'native') {
    try {
      return await window.sco.ocrRecognize(imageDataUrl);
    } catch (err) {
      // Host died mid-session: fall back to WASM and retry this read there.
      fallbackToWasm(err);
      return recognizeWorker(imageDataUrl);
    }
  }
  return recognizeWorker(imageDataUrl);
}

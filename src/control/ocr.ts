// OCR client: talks to the OCR Web Worker so inference runs off the main thread
// and never freezes the UI. PP-OCR (PaddleOCR detection + recognition) on ONNX
// Runtime Web still does the work — see ocr.worker.ts — it just lives in a
// worker now. The worker serializes jobs, so concurrent callers (the live loop
// and image scans) can't corrupt a shared ORT session.

/** One detected text line and its mean confidence (0..1). */
export interface OcrLine {
  text: string;
  score: number;
}

interface WorkerResult {
  id: number;
  lines?: OcrLine[];
  error?: string;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (lines: OcrLine[]) => void; reject: (err: Error) => void }>();

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

/** Spawn/warm the OCR worker (and begin loading models) ahead of first use. */
export function loadOcr(): void {
  getWorker();
}

/** Detect + recognize all text lines in a crop given as a PNG data URL. */
export function recognize(imageDataUrl: string): Promise<OcrLine[]> {
  const w = getWorker();
  const id = ++seq;
  return new Promise<OcrLine[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, dataUrl: imageDataUrl });
  });
}

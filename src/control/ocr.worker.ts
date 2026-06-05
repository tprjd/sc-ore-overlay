// OCR Web Worker — runs PP-OCR (PaddleOCR detection + recognition) on ONNX
// Runtime Web off the main thread so inference never freezes the UI. Same engine
// as before (the locked stack), just relocated: @gutenye/ocr-common with a
// worker-safe ImageRaw backend (OffscreenCanvas instead of document) registered
// via the library's official registerBackend hook. Jobs are serialized (one ORT
// session), which also fixes garbled reads from concurrent runs.

import Ocr, { FileUtilsBase, ImageRawBase, registerBackend } from '@gutenye/ocr-common';
import { splitIntoLineImages } from '@gutenye/ocr-common/splitIntoLineImages';
// The WebGPU build: enables the GPU execution provider (falls back to WASM).
import { env, InferenceSession } from 'onnxruntime-web/webgpu';

// No cross-origin isolation in the renderer → single-thread WASM (the WebGPU EP
// still needs the wasm/JSEP glue). ORT wasm from a CDN matching the pinned version.
env.wasm.numThreads = 1;
env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/';

/** Worker-safe image backend: OffscreenCanvas, no DOM. */
class ImageRaw extends ImageRawBase {
  constructor(d: { data: Uint8ClampedArray | number[]; width: number; height: number }) {
    const data = d.data instanceof Uint8ClampedArray ? d.data : Uint8ClampedArray.from(d.data);
    super({ data, width: d.width, height: d.height });
  }

  static async open(url: string): Promise<ImageRaw> {
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close();
    return new ImageRaw({ data: id.data, width: id.width, height: id.height });
  }

  async resize({ width, height }: { width?: number; height?: number }): Promise<this> {
    const w = Math.max(1, Math.round(width ?? (this.width / this.height) * (height ?? 1)));
    const h = Math.max(1, Math.round(height ?? (this.height / this.width) * (width ?? 1)));
    const src = new OffscreenCanvas(this.width, this.height);
    // Copy into a fresh ArrayBuffer-backed array so ImageData accepts it.
    const sdata = Uint8ClampedArray.from(this.data as ArrayLike<number>);
    src.getContext('2d')!.putImageData(new ImageData(sdata, this.width, this.height), 0, 0);
    const dst = new OffscreenCanvas(w, h);
    const dctx = dst.getContext('2d')!;
    dctx.drawImage(src, 0, 0, w, h);
    const id = dctx.getImageData(0, 0, w, h);
    this.data = id.data;
    this.width = w;
    this.height = h;
    return this;
  }

  async write(): Promise<void> {
    // no-op (debug image dump is unused)
  }

  async drawBox(): Promise<this> {
    return this;
  }
}

/** File reader backend: fetch text (the recognition dictionary). */
class FileUtils extends FileUtilsBase {
  static async read(url: string): Promise<string> {
    return (await fetch(url)).text();
  }
}

registerBackend({ FileUtils, ImageRaw, InferenceSession, splitIntoLineImages } as never);

const MODELS = {
  detectionPath: '/models/ch_PP-OCRv4_det_infer.onnx',
  recognitionPath: '/models/ch_PP-OCRv4_rec_infer.onnx',
  dictionaryPath: '/models/ppocr_keys_v1.txt',
};

interface Engine {
  detect(image: string): Promise<Array<{ text: string; mean: number }>>;
}
type CreateOpts = Parameters<typeof Ocr.create>[0];

// Default to WASM (CPU): it's the documented backend and it never touches the
// GPU, so it can't contend with the overlay window's compositor (a visible
// always-on-top overlay over a moving background otherwise starves the WebGPU
// execution provider — OCR latency spikes into the seconds and freezes). The
// renderer can opt into WebGPU via an 'init' message before the first job.
let preferred: 'wasm' | 'webgpu' = 'wasm';

async function createEngine(): Promise<Engine> {
  if (preferred === 'webgpu') {
    try {
      const engine = await Ocr.create({
        models: MODELS,
        onnxOptions: { executionProviders: ['webgpu'] },
      } as CreateOpts);
      console.info('[ocr] backend: webgpu');
      return engine as Engine;
    } catch (err) {
      console.warn('[ocr] webgpu unavailable, falling back to wasm:', err);
    }
  }
  const engine = await Ocr.create({ models: MODELS });
  console.info('[ocr] backend: wasm');
  return engine as Engine;
}

let enginePromise: Promise<Engine> | null = null;
const getEngine = (): Promise<Engine> => (enginePromise ??= createEngine());

type Msg =
  | { type: 'init'; backend: 'wasm' | 'webgpu' }
  | { type: 'recognize'; id: number; dataUrl: string };
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Msg>) => void) | null;
  postMessage: (m: unknown) => void;
};

// Serialize jobs: one ORT session can't run concurrently.
let chain: Promise<void> = Promise.resolve();
ctx.onmessage = (e: MessageEvent<Msg>): void => {
  const msg = e.data;
  if (msg.type === 'init') {
    // Backend can only be chosen before the engine is built.
    if (!enginePromise) preferred = msg.backend;
    return;
  }
  const { id, dataUrl } = msg;
  chain = chain.then(async () => {
    try {
      const ocr = await getEngine();
      const lines = await ocr.detect(dataUrl);
      ctx.postMessage({ id, lines: lines.map((l) => ({ text: l.text, score: l.mean })) });
    } catch (err) {
      ctx.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  });
};

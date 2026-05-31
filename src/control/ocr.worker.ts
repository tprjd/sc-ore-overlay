// OCR Web Worker — runs PP-OCR (PaddleOCR detection + recognition) on ONNX
// Runtime Web off the main thread so inference never freezes the UI. Same engine
// as before (the locked stack), just relocated: @gutenye/ocr-common with a
// worker-safe ImageRaw backend (OffscreenCanvas instead of document) registered
// via the library's official registerBackend hook. Jobs are serialized (one ORT
// session), which also fixes garbled reads from concurrent runs.

import Ocr, { registerBackend, ImageRawBase, FileUtilsBase } from '@gutenye/ocr-common';
import { splitIntoLineImages } from '@gutenye/ocr-common/splitIntoLineImages';
import { InferenceSession, env } from 'onnxruntime-web';

// No cross-origin isolation in the renderer → single-thread WASM; ORT wasm from
// a CDN matching the pinned version.
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
let enginePromise: Promise<Engine> | null = null;
const getEngine = (): Promise<Engine> => (enginePromise ??= Ocr.create({ models: MODELS }) as Promise<Engine>);

interface Req {
  id: number;
  dataUrl: string;
}
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Req>) => void) | null;
  postMessage: (m: unknown) => void;
};

// Serialize jobs: one ORT session can't run concurrently.
let chain: Promise<void> = Promise.resolve();
ctx.onmessage = (e: MessageEvent<Req>): void => {
  const { id, dataUrl } = e.data;
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

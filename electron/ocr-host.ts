// OCR host — runs in an Electron utilityProcess (a plain Node child with its own
// memory and, crucially, its OWN D3D12 device). It runs PP-OCR (PaddleOCR
// detection + recognition) on **onnxruntime-node with the DirectML execution
// provider** (`['dml','cpu']`), so OCR is back on the GPU but vendor-agnostic
// (any DX12 GPU: NVIDIA/AMD/Intel).
//
// Why a separate process and not the renderer's WebGPU path (see OCR-ISSUES.md /
// TASKS.md R4): in the renderer, WebGPU OCR and the always-on-top overlay
// compositor are serialized through Chromium's single GPU process, and
// onnxruntime-web 1.17.3's WebGPU EP leaks — together they ramp OCR latency into
// the seconds and freeze. A native onnxruntime-node process talks to the GPU via
// its own D3D12 device, outside Chromium's GPU process, so neither problem
// applies. Same PP-OCR models as the locked stack; only the runtime host moves.
//
// Built to CJS by vite-plugin-electron and forked from the main process. It
// communicates over `process.parentPort` (the Electron utility-process channel).
// Same engine shape as src/control/ocr.worker.ts — only the image backend
// (sharp instead of OffscreenCanvas) and InferenceSession (node instead of web)
// differ. Jobs are serialized (one ORT session can't run concurrently).

import { readFile } from 'node:fs/promises';
import type { SizeOption } from '@gutenye/ocr-common';
import Ocr, { FileUtilsBase, ImageRawBase, registerBackend } from '@gutenye/ocr-common';
import { splitIntoLineImages } from '@gutenye/ocr-common/splitIntoLineImages';
import { InferenceSession } from 'onnxruntime-node';
import sharp from 'sharp';

/** Node image backend: sharp, decoding a `data:` URL or a file path to RGBA. */
class ImageRaw extends ImageRawBase {
  static async open(input: string): Promise<ImageRaw> {
    // The renderer sends a PNG `data:` URL (same contract as the Web Worker);
    // a bare path is also accepted so the spike/debug tooling can pass a file.
    const buf = input.startsWith('data:')
      ? Buffer.from(input.slice(input.indexOf(',') + 1), 'base64')
      : await readFile(input);
    // 4-channel RGBA to match the browser getImageData backend the library is
    // proven against (its recognition path expects that channel layout).
    const { data, info } = await sharp(buf)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return new ImageRaw({
      data: new Uint8ClampedArray(data),
      width: info.width,
      height: info.height,
    });
  }

  async resize({ width, height, fit }: SizeOption): Promise<this> {
    const w = Math.max(1, Math.round(width ?? (this.width / this.height) * (height ?? 1)));
    const h = Math.max(1, Math.round(height ?? (this.height / this.width) * (width ?? 1)));
    const { data } = await sharp(Buffer.from(this.data), {
      raw: { width: this.width, height: this.height, channels: 4 },
    })
      .resize(w, h, { fit: fit ?? 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    this.data = new Uint8ClampedArray(data);
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

/** File reader backend: read the recognition dictionary from disk. */
class FileUtils extends FileUtilsBase {
  static async read(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }
}

registerBackend({ FileUtils, ImageRaw, InferenceSession, splitIntoLineImages } as never);

interface Engine {
  detect(image: string): Promise<Array<{ text: string; mean: number }>>;
}
type CreateOpts = Parameters<typeof Ocr.create>[0];

interface ModelPaths {
  detectionPath: string;
  recognitionPath: string;
  dictionaryPath: string;
}

let enginePromise: Promise<Engine> | null = null;

async function createEngine(models: ModelPaths): Promise<Engine> {
  // DirectML first (vendor-agnostic GPU), CPU as the in-ORT fallback so a
  // machine without a usable DX12 device still reads (just slower).
  const engine = await Ocr.create({
    models,
    onnxOptions: { executionProviders: ['dml', 'cpu'] },
  } as CreateOpts);
  return engine as Engine;
}

// --- Utility-process channel -------------------------------------------------
// Minimal structural type for the Electron utilityProcess parent port (the
// exported type name varies across Electron versions; only these members are used).
interface ParentPortLike {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
}
const parentPort = (process as unknown as { parentPort: ParentPortLike }).parentPort;

type InMsg =
  | { type: 'init'; models: ModelPaths }
  | { type: 'recognize'; id: number; dataUrl: string };

// Serialize jobs: one ORT session can't run concurrently (same as the worker).
let chain: Promise<void> = Promise.resolve();

parentPort.on('message', (e: { data: unknown }) => {
  const msg = e.data as InMsg;

  if (msg.type === 'init') {
    if (!enginePromise) {
      enginePromise = createEngine(msg.models);
      enginePromise.then(
        () => parentPort.postMessage({ type: 'ready' }),
        (err: unknown) =>
          parentPort.postMessage({
            type: 'init-error',
            error: err instanceof Error ? err.message : String(err),
          }),
      );
    }
    return;
  }

  const { id, dataUrl } = msg;
  chain = chain.then(async () => {
    try {
      if (!enginePromise) throw new Error('OCR host not initialized');
      const ocr = await enginePromise;
      const lines = await ocr.detect(dataUrl);
      parentPort.postMessage({
        type: 'result',
        id,
        lines: lines.map((l) => ({ text: l.text, score: l.mean })),
      });
    } catch (err) {
      parentPort.postMessage({
        type: 'result',
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
});

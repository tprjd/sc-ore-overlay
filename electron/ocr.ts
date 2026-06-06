// Native OCR host client (main side). A Node utility process with its own D3D12
// device runs onnxruntime-node + DirectML, so GPU OCR doesn't contend with the
// overlay the way in-renderer WebGPU does (see electron/ocr-host.ts / TASKS.md
// R4). Spawned lazily on first probe; the renderer falls back to the in-renderer
// WASM worker if it can't start. Exposes the IPC handlers + a kill for shutdown.

import path from 'node:path';
import type { IpcMainInvokeEvent, UtilityProcess } from 'electron';
import { ipcMain, utilityProcess } from 'electron';
import type { OcrLine } from '../src/shared/bridge';
import { DEV_SERVER_URL, DIST_ELECTRON } from './env';
import { log } from './log';

let ocrHost: UtilityProcess | null = null;
let ocrReady: Promise<boolean> | null = null;
let ocrSeq = 0;
const ocrPending = new Map<
  number,
  { resolve: (lines: OcrLine[]) => void; reject: (err: Error) => void }
>();

/** Absolute dir holding the PP-OCR models (dev: public/models; prod: resources). */
function ocrModelDir(): string {
  return DEV_SERVER_URL
    ? path.join(DIST_ELECTRON, '..', 'public', 'models')
    : path.join(process.resourcesPath, 'models');
}

/** Fork the OCR host (once) and resolve true when DirectML/CPU init succeeds. */
function startOcrHost(): Promise<boolean> {
  if (ocrReady) return ocrReady;
  ocrReady = new Promise<boolean>((resolve) => {
    let host: UtilityProcess;
    try {
      // Pipe (not inherit) so the host's stdout/stderr land in main.log too —
      // packaged builds have no terminal, and OCR is the most failure-prone path.
      host = utilityProcess.fork(path.join(DIST_ELECTRON, 'ocr-host.js'), [], {
        serviceName: 'sco-ocr-host',
        stdio: 'pipe',
      });
    } catch (err) {
      log.error('[ocr] failed to fork host:', err);
      ocrReady = null;
      resolve(false);
      return;
    }
    ocrHost = host;
    host.stdout?.on('data', (d: Buffer) => log.info('[ocr-host]', d.toString().trimEnd()));
    host.stderr?.on('data', (d: Buffer) => log.warn('[ocr-host]', d.toString().trimEnd()));
    const dir = ocrModelDir();
    host.on('spawn', () => {
      host.postMessage({
        type: 'init',
        models: {
          detectionPath: path.join(dir, 'ch_PP-OCRv4_det_infer.onnx'),
          recognitionPath: path.join(dir, 'ch_PP-OCRv4_rec_infer.onnx'),
          dictionaryPath: path.join(dir, 'ppocr_keys_v1.txt'),
        },
      });
    });
    host.on('message', (msg: { type: string; id?: number; lines?: OcrLine[]; error?: string }) => {
      if (msg.type === 'ready') {
        resolve(true);
      } else if (msg.type === 'init-error') {
        log.error('[ocr] host init error:', msg.error);
        resolve(false);
      } else if (msg.type === 'result' && typeof msg.id === 'number') {
        const p = ocrPending.get(msg.id);
        if (!p) return;
        ocrPending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.lines ?? []);
      }
    });
    host.on('exit', (code) => {
      log.warn('[ocr] host exited:', code);
      ocrHost = null;
      ocrReady = null; // allow a re-spawn on the next probe
      for (const p of ocrPending.values()) p.reject(new Error('OCR host exited'));
      ocrPending.clear();
      resolve(false); // no-op if already resolved (e.g. ready earlier)
    });
  });
  return ocrReady;
}

/** Register the OCR probe/recognize IPC handlers. */
export function registerOcrIpc(): void {
  ipcMain.handle('sco:ocr-available', (): Promise<boolean> => startOcrHost());
  ipcMain.handle(
    'sco:ocr-recognize',
    async (_e: IpcMainInvokeEvent, dataUrl: string): Promise<OcrLine[]> => {
      const ok = await startOcrHost();
      if (!ok || !ocrHost) throw new Error('OCR host unavailable');
      const host = ocrHost;
      const id = ++ocrSeq;
      return new Promise<OcrLine[]>((resolve, reject) => {
        ocrPending.set(id, { resolve, reject });
        host.postMessage({ type: 'recognize', id, dataUrl });
      });
    },
  );
}

export function killOcrHost(): void {
  ocrHost?.kill();
}

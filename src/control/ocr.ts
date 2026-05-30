// OCR via PP-OCR (PaddleOCR detection + recognition models) on ONNX Runtime
// Web, in the renderer (@gutenye/ocr-browser).
//
// Why PP-OCR: it does text *detection* then *recognition*, so it localizes the
// digits inside an imperfectly-drawn region (ignoring the pin icon / padding)
// and reads the raw color text on any background — verified reading "17,080" at
// 0.99 confidence on sloppy crops. No binarization/threshold tuning needed.
//
// The heavy libs (@gutenye/ocr-browser + onnxruntime-web, ~MBs of WASM) are
// imported lazily on the first scan so the control UI renders instantly and a
// load failure can't blank the whole window. Models are bundled under
// /public/models; ONNX Runtime Web's WASM is fetched from a CDN in dev
// (packaging bundles it locally — Phase 4).

const MODELS = {
  detectionPath: '/models/ch_PP-OCRv4_det_infer.onnx',
  recognitionPath: '/models/ch_PP-OCRv4_rec_infer.onnx',
  dictionaryPath: '/models/ppocr_keys_v1.txt',
};

/** One detected text line and its mean confidence (0..1). */
export interface OcrLine {
  text: string;
  score: number;
}

interface OcrEngine {
  detect(image: string): Promise<Array<{ text: string; mean: number }>>;
}

let enginePromise: Promise<OcrEngine> | null = null;

async function init(): Promise<OcrEngine> {
  const [{ default: Ocr }, ort] = await Promise.all([
    import('@gutenye/ocr-browser'),
    import('onnxruntime-web'),
  ]);
  // No cross-origin isolation in the renderer → single-thread WASM. Load the ORT
  // wasm from a CDN matching the pinned onnxruntime-web version.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/';
  return Ocr.create({ models: MODELS }) as Promise<OcrEngine>;
}

/** Lazily create (and cache) the PP-OCR engine. First call loads the models. */
export function loadOcr(): Promise<OcrEngine> {
  if (!enginePromise) enginePromise = init();
  return enginePromise;
}

/** Detect + recognize all text lines in a crop given as a PNG data URL. */
export async function recognize(imageDataUrl: string): Promise<OcrLine[]> {
  const engine = await loadOcr();
  const lines = await engine.detect(imageDataUrl);
  return lines.map((l) => ({ text: l.text, score: l.mean }));
}

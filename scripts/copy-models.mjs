// Copy the PP-OCR models from the @gutenye/ocr-models dependency into
// public/models so Vite serves them. Run automatically via predev/prebuild;
// keeps the ~15MB binaries out of git (they're reproducible from the dep).
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SRC = path.join('node_modules', '@gutenye', 'ocr-models', 'assets');
const DST = path.join('public', 'models');
const FILES = ['ch_PP-OCRv4_det_infer.onnx', 'ch_PP-OCRv4_rec_infer.onnx', 'ppocr_keys_v1.txt'];

await mkdir(DST, { recursive: true });
for (const file of FILES) {
  await copyFile(path.join(SRC, file), path.join(DST, file));
}
console.log(`copied ${FILES.length} PP-OCR model files → ${DST}`);

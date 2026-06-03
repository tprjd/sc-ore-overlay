// R4.0 — DirectML feasibility gate (run on Windows).
//
// Answers the one make-or-break question for TASKS.md R4: does the prebuilt
// `onnxruntime-node` binary on this machine actually ship the DirectML execution
// provider, and can it read a real RS crop with low, FLAT latency (no ramp)?
//
// Two checks:
//   1. Raw ORT: create a session on the detection model with ONLY ['dml'].
//      onnxruntime-node errors if DirectML isn't compiled into the binary, so a
//      successful create == DirectML is present (no silent CPU fallback, because
//      we don't list 'cpu').
//   2. End-to-end: build the same PP-OCR pipeline the app uses (@gutenye/ocr-node)
//      with ['dml','cpu'] and read a crop N times, printing per-run ms to expose
//      any run-over-run ramp (the WebGPU-leak signature we're trying to escape).
//
// Run (from repo root, on Windows):
//   npm i -D onnxruntime-node @gutenye/ocr-node
//   npx tsx scripts/ocr-dml-spike.ts path\to\rs-crop.png
//
// If no crop path is given it looks for scripts/sample-crop.png. Use any tight
// screenshot of just the RS number (PNG). Paste the printed text + timings back.

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

const MODELS = {
  detectionPath: path.join(repoRoot, 'public', 'models', 'ch_PP-OCRv4_det_infer.onnx'),
  recognitionPath: path.join(repoRoot, 'public', 'models', 'ch_PP-OCRv4_rec_infer.onnx'),
  dictionaryPath: path.join(repoRoot, 'public', 'models', 'ppocr_keys_v1.txt'),
};

const cropPath = process.argv[2] ?? path.join(here, 'sample-crop.png');
const RUNS = 8;

function line(): void {
  console.log('─'.repeat(64));
}

async function checkModels(): Promise<boolean> {
  let ok = true;
  for (const [k, p] of Object.entries(MODELS)) {
    const present = existsSync(p);
    console.log(`  ${present ? '✓' : '✗'} ${k}: ${p}`);
    if (!present) ok = false;
  }
  return ok;
}

// --- Check 1: is the DirectML EP present in the prebuilt binary? --------------
async function checkDirectMLAvailable(): Promise<boolean> {
  line();
  console.log('CHECK 1 — DirectML EP present in onnxruntime-node?');
  let ort: typeof import('onnxruntime-node');
  try {
    ort = require('onnxruntime-node');
  } catch (err) {
    console.log('  ✗ onnxruntime-node failed to load:', err instanceof Error ? err.message : err);
    console.log('    → run: npm i -D onnxruntime-node');
    return false;
  }
  try {
    const ver = require('onnxruntime-node/package.json').version as string;
    console.log(`  onnxruntime-node version: ${ver}`);
  } catch {
    /* version is informational only */
  }

  // ONLY ['dml'] — no 'cpu' fallback listed, so a silent CPU substitution can't
  // mask an absent DirectML EP. Success here means DirectML really loaded.
  try {
    const session = await ort.InferenceSession.create(MODELS.detectionPath, {
      executionProviders: ['dml'],
    });
    console.log('  ✓ session created with executionProviders: ["dml"]');
    console.log('    input names:', session.inputNames.join(', '));
    return true;
  } catch (err) {
    console.log('  ✗ ["dml"] rejected:', err instanceof Error ? err.message : err);
    console.log('    → DirectML is NOT in this onnxruntime-node build. R4.0 gate FAILS.');
    console.log('      Document the required ORT distribution before continuing R4.');
    return false;
  }
}

// --- Check 2: end-to-end read + latency ramp ----------------------------------
async function checkEndToEnd(): Promise<void> {
  line();
  console.log('CHECK 2 — PP-OCR read via @gutenye/ocr-node (["dml","cpu"])');
  if (!existsSync(cropPath)) {
    console.log(`  ✗ no crop image at: ${cropPath}`);
    console.log('    → pass one: npx tsx scripts/ocr-dml-spike.ts path\\to\\rs-crop.png');
    return;
  }
  console.log(`  crop: ${cropPath}`);

  let Ocr: typeof import('@gutenye/ocr-node').default;
  try {
    Ocr = require('@gutenye/ocr-node').default ?? require('@gutenye/ocr-node');
  } catch (err) {
    console.log('  ✗ @gutenye/ocr-node failed to load:', err instanceof Error ? err.message : err);
    console.log('    → run: npm i -D @gutenye/ocr-node');
    return;
  }

  const t0 = performance.now();
  const ocr = await Ocr.create({
    models: MODELS,
    onnxOptions: { executionProviders: ['dml', 'cpu'] },
  } as Parameters<typeof Ocr.create>[0]);
  console.log(`  engine built in ${(performance.now() - t0).toFixed(0)} ms`);

  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const s = performance.now();
    const lines = (await ocr.detect(cropPath)) as Array<{ text: string; mean?: number }>;
    const ms = performance.now() - s;
    times.push(ms);
    const best = lines.slice().sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0))[0];
    console.log(
      `  run ${i + 1}/${RUNS}: ${ms.toFixed(0).padStart(5)} ms  ` +
        `lines=${lines.length}  best="${best?.text ?? ''}" (${(best?.mean ?? 0).toFixed(2)})`,
    );
  }

  line();
  const first = times[0];
  const last = times[times.length - 1];
  const min = Math.min(...times);
  const max = Math.max(...times);
  console.log(`  latency: first=${first.toFixed(0)}  last=${last.toFixed(0)}  min=${min.toFixed(0)}  max=${max.toFixed(0)} ms`);
  // A healthy GPU path is flat. A ramp (last >> first) is the leak we're escaping.
  const ramping = last > first * 1.6 && last - first > 200;
  console.log(
    ramping
      ? '  ⚠ latency RAMPS run-over-run — same leak signature as ORT-web WebGPU. Flag it.'
      : '  ✓ latency is flat across runs (no ramp).',
  );
}

async function main(): Promise<void> {
  console.log('R4.0 DirectML OCR spike');
  line();
  console.log('models present?');
  if (!(await checkModels())) {
    console.log('  ✗ models missing — run from repo root so public/models resolves.');
    process.exit(1);
  }

  const dml = await checkDirectMLAvailable();
  await checkEndToEnd();

  line();
  console.log(dml ? 'GATE: PASS — DirectML available. Proceed to R4.1.' : 'GATE: FAIL — see CHECK 1.');
  process.exit(dml ? 0 : 1);
}

void main();

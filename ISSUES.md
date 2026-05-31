# ISSUES.md — performance & correctness backlog

Snapshot review of known issues, ranked by impact, with fix sketches. Most wins
are **zero-dependency** (the project is intentionally low-dep). Status reflects
work through commit `f65213b` (OCR moved to a Web Worker + input-size cap).

Legend: ✅ done · 🔲 open · 💤 later/packaging.

---

## Performance

### ✅ OCR ran on the renderer main thread (UI froze during scanning)
Each ONNX Runtime Web inference is a synchronous WASM call → blocked the UI for
its duration. **Resolved** in `f65213b`: OCR runs in `src/control/ocr.worker.ts`
(serialized jobs, one ORT session). Also capped the upscaled crop's longest side
at 1600px in `src/control/preprocess.ts` (detection time ∝ pixel count).

### 🔲 1. `toDataURL('image/png')` PNG-encode on the hot path  — highest remaining
`preprocess()` PNG-encodes every crop on the **main thread**, every tick per
region (live loop) + every uploaded image. With OCR now off-thread, this encode
is the main remaining main-thread cost.
- **Fix (zero-dep):** transfer raw **ImageData** (`ArrayBuffer`, transferable) to
  the worker instead of a PNG data URL. Skips the encode *and* the worker's
  decode (`ImageRaw.open`) — the worker's `OffscreenCanvas` `ImageRaw` can be
  built straight from pixels.
- **Files:** `src/control/preprocess.ts`, `src/control/ocr.ts`,
  `src/control/ocr.worker.ts`, callers in `useCaptureLoop.ts` / `useSurveyCapture.ts` / `scanImage.ts`.

### 🔲 2. ORT execution provider is WASM single-thread
`numThreads=1`, CPU WASM (no cross-origin isolation). On a real GPU (Windows),
onnxruntime-web's **WebGPU** execution provider is much faster for detection +
recognition.
- **Fix:** pass `executionProviders:['webgpu']` (with WASM fallback) when creating
  the ORT sessions. Note `electron/main.ts` currently calls
  `app.disableHardwareAcceleration()` for WSL — gate that off on real hardware.
- **Files:** `src/control/ocr.worker.ts`, `electron/main.ts`. Investigate first;
  potentially the largest inference speedup.

### ✅ 3. Map redraws the whole canvas on every hover
**Resolved** (`48b7e1b`): resize the canvas backing store only when the size
changes (setting `canvas.width` reallocates + clears), and only update `hover`
state when the hovered point changes — plain mouse movement no longer redraws.
- **File:** `src/control/components/SurveyMap.tsx`.

### 🔲 4. Per-tick allocations / hashing
A new `<canvas>`/`OffscreenCanvas` + `getImageData` + a full-crop `hashPixels`
run every tick. Reuse one canvas; sample the hash instead of hashing all pixels.
- **Files:** `src/control/preprocess.ts`, `src/core/image.ts`. Minor.

---

## Correctness / robustness

### ✅ 5. Garbage scans still get logged
**Resolved** (`48b7e1b`) for the live path: logging requires the recent ship
positions to agree within 5 km (parked), so a one-frame misread isn't recorded
(`isStablePos` in `src/core/survey.ts`, + tests). Uploaded-image scans still use
parser-only validation (single shot, no temporal signal) — tighten later if
needed (match ore to the table; near-duplicate collapse is #7/S5).

### 💤 6. Production model paths (`file://`)
`/models/*.onnx` is fetched by URL — works in dev (http) but a packaged build
(`file://`, and now inside the worker) will fail to resolve.
- **Fix at packaging:** serve via a custom protocol or resolve a bundled path.
- **Files:** `src/control/ocr.worker.ts`, electron-builder config. Phase 4.

### 🔲 7. No scan de-duplication
Logging the same rock twice creates two entries/points. Planned as S5 in
`SURVEY-MODE.md` (near-duplicate collapse by position + ore).

### 🔲 8. OCR ore-name garble
Cleaned names like `Berylicf)` slip through `cleanOre` when the scan line is
noisy. Cosmetic; could match against the signature table's ore names.
- **File:** `src/core/scan.ts`.

---

## Libraries (only the few worth it)

The project is deliberately low-dep and most fixes above need **no library**.
Candidates that genuinely reduce code:

- **`comlink`** (~3 kB) — replace the manual `id`/`pending`-map worker RPC in
  `ocr.ts` with `await worker.recognize(...)`. Cleaner, less code.
- **`react-virtuoso`** / `react-window` — virtualize the scan-results and log
  lists **only if** they grow to hundreds of rows. Not needed yet.
- **`zustand`** (~1 kB) — `App.tsx` has a lot of `useState` + manual
  settings-sync; a small store with persist middleware would shrink it. Optional.

**Explicitly skip:** map libs (d3 / pixi / deck.gl) — the canvas is fine; OCR
libs — locked stack; CSV libs — hand-rolled export is fine.

---

## Suggested order
1. ~~Pixels → worker (kills the PNG-encode stall)~~ — **open**; touches the OCR
   worker path (unverifiable headless) + trades off the debug-crop preview. Do as
   a focused step with in-app verification.
2. ~~Map redraw throttle~~ — ✅ `48b7e1b`.
3. ~~Plausibility-gate logging~~ — ✅ `48b7e1b` (live path; stability gate).
4. WebGPU execution provider — **open**; investigate (needs a real GPU + in-app
   test; big inference win).
5. `comlink` cleanup — optional (adds a dep; touches the worker RPC).
6. Production model paths — 💤 before packaging (Phase 4).

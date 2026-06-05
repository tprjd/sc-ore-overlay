# OCR Issues — diagnosis & fixes

A running log of the OCR performance problem that surfaced during the UX chapter,
how it was diagnosed, and the fixes that shipped. Keep this updated if the OCR
pipeline regresses again.

---

## Symptom

The mining scanner number was read correctly almost instantly (visible in the
Capture-tab region preview), but the **accepted reading never locked**: the
overlay sat on `locking…` / the panel showed `settling`, the capture `rate`
dropped toward zero, the `ocr` latency in the footer **climbed** (seen as high
as **24,000 ms**), and eventually even the source **video playback stalled**.

It had "worked great ~20 commits ago" with the same clip and the same
interval/quorum settings, so it read as a regression.

---

## How it was diagnosed

1. **Not the voter math, at first glance.** The temporal voter needs N agreeing
   frames; with the original *consecutive*-quorum voter a single jittered OCR
   frame reset the streak, so it could stay `settling` forever. Real, but not the
   whole story.

2. **Pipeline unchanged.** `git log` over the suspect window showed the OCR read
   path — `preprocess → recognize → pickReading` (`src/control/preprocess.ts`,
   `src/control/ocr.ts`, `src/control/ocr.worker.ts`, `src/core/parse.ts`,
   `src/core/matcher.ts`) — was **byte-identical** to v0.3.0. Only UI
   (`ScanView`, `OverlayCard`) and, later, the fix changed. So the reads weren't
   getting worse; something *runtime* was.

3. **The latency *climbs*, then freezes.** A first read was fast, then `ocr` ms
   grew run-over-run until it stalled. Progressive degradation under sustained
   back-to-back inference = a GPU/resource problem, not steady CPU cost.

4. **Backend was WebGPU.** `ocr.worker.ts` logged `[ocr] backend: webgpu`.

5. **The decisive test — hide the overlay.** With the overlay hidden
   (`Alt+Shift+O`) the OCR **locked instantly and stayed fast**. With the overlay
   **shown**, it stalled — *even with every overlay feature off* (Minimal preset:
   no placeholder/pulse, no blur, no detail/scan/OCR-stats), and **regardless of
   which control-window tab was open**.

That isolates it to the **bare visible overlay window**, not any specific
overlay style or animation.

---

## Root cause

A **visible, always-on-top, transparent overlay window composited over a moving
background** and the **WebGPU OCR execution provider** contend for the **same
GPU**. When the overlay is up, the compositor wins GPU time and WebGPU OCR
starves — its submissions queue and latency spikes into the seconds. Because OCR
can't produce timely reads, the voter never reaches quorum, so the overlay keeps
showing the (animated) `locking…` state, which keeps the compositor busy: a
**feedback loop** that ramps until everything (OCR, capture rate, even video
decode) freezes.

Why it regressed ~20 commits ago: the WebGPU-vs-overlay contention always
existed, but the UX work in that window **raised the per-frame GPU/render load**
enough to tip it over — chiefly:

- **F3** (live OCR stats): `sendMatches` fires **every capture tick** when OCR
  stats are on, re-rendering all overlay windows each frame.
- **U4** (live preview) and the overlay cards' **`backdrop-filter: blur`**:
  re-blurring a moving background recomputes every frame.

Earlier builds left the overlay idle after a fast lock, so the GPU was free for
OCR; the heavier per-frame overlay work removed that headroom.

---

## Fixes implemented

### 1. Reliable lock + bounded inference — `d04aedd`
- **Windowed-majority voter** (`src/core/validator.ts`). A value latches on
  `quorum` of the last `quorum + 1` readings and stays sticky until a different
  value wins the window. A single stray/jittered OCR frame no longer blocks the
  lock or flickers it to null — this breaks the "never locks" leg of the loop.
  Tests updated/added in `test/validator.test.ts` (stray tolerance, sticky flip,
  null handling).
- **Per-region OCR backoff** (`src/control/useSurveyCapture.ts`). Once a region's
  parsed result repeats `STABLE_RUNS` (3) times, inference is skipped within a
  `STABLE_INTERVAL_MS` (1000 ms) heartbeat — the last result is reused and the
  crop refreshed so the preview stays live. Bounds WebGPU/CPU work during steady
  mining; full-rate OCR resumes the instant the reading changes.

### 2. Drop the overlay backdrop-blur — `27971b3`
- Removed `backdrop-filter: blur(2px)` from `OverlayCard`, `DetailCard`,
  `ScanCard`. An always-on-top window re-blurring a moving background is
  continuous per-frame GPU work. **Helped but was not sufficient** — the bare
  composited overlay still starved WebGPU.

### 3. Default OCR to WASM (CPU) — `f4699ad` (the actual fix)
- The contention is GPU-vs-GPU, so OCR was moved **off the GPU**. The worker now
  defaults to the **WASM (CPU)** backend — the backend CLAUDE.md documents as the
  locked one; WebGPU was a later add-on and is what collided with the overlay.
- `src/control/ocr.worker.ts`: `preferred = 'wasm'` by default; an `init` message
  lets the renderer opt into `webgpu` before the engine is built.
- `src/control/ocr.ts`: `setOcrBackend()` / `loadOcr(backend)`; recognize
  messages are tagged `{ type: 'recognize' }`.
- `AppSettings.ocrBackend: 'wasm' | 'webgpu'` (`src/shared/bridge.ts`), selected
  on launch in `App.tsx` **before any capture starts**.

Result: WASM never touches the GPU, so OCR and the overlay no longer contend —
no ramp, no freeze, video stays smooth, overlay can be shown.

---

## Knobs

- **Backend** — **default `directml`** (R5), selectable in the UI (Capture tab →
  "OCR backend"). The active engine is shown in the status footer (`eng`).
  - `directml` — native GPU OCR (default). GPU-accelerated on any DX12 GPU
    without the overlay contention. Auto-falls back to `wasm` if the native host
    can't start, so non-DX12 machines stay safe.
  - `wasm` — CPU, in-renderer. The fallback; never touches the GPU. ~1–2 s/read.
  - `webgpu` — in-renderer GPU. Faster than wasm when it works, but **stalls with
    the overlay on some setups** (the bug this doc is about). Not recommended;
    kept for the curious.
- **WASM is single-thread** (`env.wasm.numThreads = 1` in `ocr.worker.ts`, no
  cross-origin isolation), so a *new* read costs ~1–2 s. Mitigate by **tightening
  the RS box and lowering upscale** (Capture tab) — less area = faster inference.
- **`quorum` / `interval`** (Capture → Timing) trade lock speed vs. robustness.
- **`minConfidence`** (Capture → Timing, R6) — minimum OCR confidence (0..1) to
  accept a reading. Below it the frame is treated as *no reading* (fed to the
  voter as null), so clear garbage can't move the lock. PP-OCR scores run high;
  default 0.5. 0 = accept everything.
- **`holdMs`** (Overlay → "Hold reading", R6) — how long the last ore stays on
  the overlay after the RS reading disappears, then the *value* is cleared. This
  is **distinct from `idleMs`**: `idleMs` only fades the *opacity* (the value
  persists underneath and snaps back on the next tick); `holdMs` drops the value
  entirely (status → `expired`). `0` = never drop (sticky forever, legacy).
- **Why nothing shows (R6)** — the read pipeline emits an `OverlayStatus`
  (`held` / `expired` / `low-conf` / `no-rs` / `no-scan` / `source-lost`) shown
  in the control footer and as a reason chip on the overlay placeholder, so a
  blank overlay always explains itself instead of failing silently. A lost
  capture source hides the overlay entirely; SCAN RESULTS parsing is strict
  (`parseScanResult`), so the scan box only appears when a real panel is on screen.

---

## Update (R4) — native DirectML backend (GPU OCR without the contention)

The real fix for "use the GPU without stalling." WebGPU stalled not because the
GPU is weak (a single small crop is trivial for any modern GPU) but because of
**two web-stack weaknesses**: Chromium serializes WebGPU and the overlay
compositor through one GPU process / one command queue, and onnxruntime-web
1.17.3's WebGPU EP leaks (the *ramp* signature). Neither is the hardware.

So OCR moved onto a **native `onnxruntime-node` process using the DirectML
execution provider** (`ocrBackend: 'directml'`):

- Runs in an **Electron `utilityProcess`** (`electron/ocr-host.ts`) — a Node child
  with **its own D3D12 device**, outside Chromium's GPU process. No compositor
  serialization, and native ORT memory management (no ORT-web leak).
- **DirectML** → vendor-agnostic: any DX12 GPU (NVIDIA / AMD / Intel), not CUDA.
- **Same PP-OCR models** (`ch_PP-OCRv4_det/rec`); only the runtime host changed.
  The renderer reaches it via `window.sco.ocrRecognize` (preload bridge → main →
  utility process). `src/control/ocr.ts` picks the transport from the backend
  setting and **auto-falls back to the WASM worker** if the host can't start or
  dies. WASM stays the in-renderer fallback; WebGPU is kept but off by default.
- **Measured (R4.0 gate, real Windows GPU):** read "17,080" @ 0.99; latency
  ~1.3 s warmup then **flat ~28–33 ms**, no ramp. vs WASM ~1–2 s, vs broken
  WebGPU ramping to 24,000 ms.

Sanctioned locked-stack deviation (see TASKS.md R4 / CLAUDE.md). **Still needs the
in-app Windows verification checkpoint** — the R4.0 gate proved the engine in
isolation; confirm the overlay-up stall is gone in the running app.

## Possible follow-ups (not yet done)

- **Make `directml` the default** once the in-app Windows checkpoint confirms it
  (currently opt-in via settings; default stays `wasm`).
- **Raw-RGBA image transport** to the host (transferable `ArrayBuffer` + dims)
  instead of a PNG data URL, skipping a PNG encode/decode on the hot path; and
  `MessageChannelMain` so the renderer talks to the utility process directly
  rather than bouncing image data through main.
- **Multi-threaded WASM** via cross-origin isolation (COOP/COEP → `SharedArrayBuffer`)
  — ~4–8× faster CPU OCR for the non-DX12 fallback path, still off the GPU.
- **Reduce per-tick overlay re-renders**: throttle the OCR-stats field so
  `sendMatches` doesn't fire every tick (relevant again if WebGPU is re-enabled).

# NOTES.md — engineering notes, knobs & roadmap

Consolidated reference that outlived the per-feature plan/task/issue docs (now removed;
their history is in git). For the locked stack, domain knowledge, matcher spec, and
guardrails see **`CLAUDE.md`**. For the release process see **`RELEASING.md`**; for the
deferred Survey feature see **`SURVEY-MODE.md`**.

Status: **v1.0.0-rc.1**. Ship-mining v1 is complete (capture → OCR → match → live
overlay), both human-verification gates passed, the DirectML OCR backend and the
overlay-presence/staleness work shipped and were confirmed in-game on real Windows.

---

## OCR pipeline — architecture, why, knobs

The single most load-bearing subsystem. Engine is **PP-OCR** (`ch_PP-OCRv4_det/rec`
ONNX models) — unchanged across every backend; only the *runtime host* differs.

### Backends (selectable in Capture tab → "OCR backend"; active one shown in the footer `eng`)
- **`directml` — default.** Native `onnxruntime-node` in an Electron `utilityProcess`
  (`electron/ocr-host.ts`) with its own D3D12 device, DirectML EP → GPU OCR on any DX12
  GPU (NVIDIA/AMD/Intel). ~28–33 ms/read once warm. Auto-falls back to `wasm` if the host
  can't start or DirectML init fails.
- **`wasm` — fallback.** In-renderer ONNX-Runtime-Web, CPU, single-thread
  (`env.wasm.numThreads = 1`). Never touches the GPU. ~1–2 s/fresh read. The locked path
  CLAUDE.md documents; always available.
- **`webgpu` — not recommended.** In-renderer GPU. Faster when it works but **stalls with
  the overlay shown on some setups** (see root cause below). Kept for the curious.

### The WebGPU stall (root cause — why the backends above exist)
A visible, always-on-top, transparent overlay composited over a moving game and the
in-renderer **WebGPU** OCR contend for the **same GPU**. Chromium serializes WebGPU + the
compositor through one GPU process / one command queue, so the overlay (latency-priority)
starves OCR (best-effort); `onnxruntime-web` 1.17.3's WebGPU EP also leaks. The tell:
latency **ramps** run-over-run (seen up to 24,000 ms) then freezes — OCR never reaches
quorum, the overlay keeps animating `locking…`, which keeps the compositor busy: a feedback
loop that locks up OCR, capture rate, even video decode. Diagnosis clincher: hiding the
overlay made OCR instant.
**Fix:** run OCR off the renderer's GPU path. `directml` (separate Node process, own D3D12
device) bypasses both the Chromium serialization and the ORT-web leak; `wasm` sidesteps the
GPU entirely. Both verified stable with the overlay up.

### Knobs
- **`quorum` / `interval`** (Capture → Timing; also Fast/Normal/Slow presets) — lock speed
  vs. robustness. Voter is a **windowed-majority** voter (`src/core/validator.ts`): latches
  on `quorum` of the last `quorum+1` reads, sticky until a different value wins the window —
  a single jittered frame can't block or flip the lock.
- **`minConfidence`** (Capture → Timing) — min OCR confidence (0..1) to accept a read; below
  it the frame is fed to the voter as `null` so garbage can't move the lock. PP-OCR scores
  run high; default 0.5. 0 = accept everything.
- **`holdMs`** (Overlay → "Hold reading") — how long the last ore stays after the RS chip
  leaves, then the *value* is cleared (status → `expired`). Distinct from **`idleMs`**, which
  only fades *opacity* (value persists underneath). 0 = never drop.
- **Why nothing shows** — the read pipeline emits an `OverlayStatus`
  (`ok`/`no-match`/`held`/`expired`/`low-conf`/`no-rs`/`no-scan`/`source-lost`/`inactive`)
  shown in the footer and as a reason chip on the overlay, so a blank overlay always explains
  itself. `inactive` = no source / Mining view not live → overlay hidden. `source-lost` hides
  it entirely. SCAN RESULTS parsing is strict (`parseScanResult`), so the scan box only shows
  on a real panel.
- Tighten the RS box + lower upscale (Capture) to cut inference time (cost ∝ pixel count;
  upscaled crop is capped at 1600px longest side in `preprocess.ts`).

### OCR follow-ups (not done)
- **Raw-RGBA image transport** to the host/worker (transferable `ArrayBuffer` + dims) instead
  of a PNG data URL — skips a PNG encode/decode on the hot path (this is also perf item #1
  below). `MessageChannelMain` so the renderer talks to the utility process directly instead
  of bouncing buffers through main.
- **Multi-threaded WASM** via cross-origin isolation (COOP/COEP → `SharedArrayBuffer`) —
  ~4–8× faster CPU OCR for the non-DX12 fallback, still off the GPU.
- **Throttle the OCR-stats field** so `sendMatches` doesn't fire every tick (only matters if
  WebGPU is ever re-enabled).

---

## Performance / correctness backlog (open)

Legend: 🔲 open · 💤 later. Most wins are zero-dependency (the project is intentionally low-dep).

- 🔲 **PNG-encode on the hot path (highest).** `preprocess()` PNG-encodes every crop on the
  main thread, every tick per region. Transfer raw **ImageData** (transferable) to the
  worker/host instead — skips the encode *and* the worker's decode. Touches
  `preprocess.ts`, `ocr.ts`, `ocr.worker.ts`, `electron/ocr-host.ts`, and callers
  (`useCaptureLoop`/`useSurveyCapture`/`scanImage`). Verify in-app (the debug-crop preview
  trades off). Same item as the raw-RGBA OCR follow-up above.
- 🔲 **Per-tick allocations / hashing (minor).** A new canvas + `getImageData` +
  full-crop `hashPixels` every tick. Reuse one canvas; sample the hash. `preprocess.ts`,
  `src/core/image.ts`.
- 🔲 **Scan de-duplication.** Logging the same rock twice creates duplicate entries/points.
  Planned as S5 in `SURVEY-MODE.md` (collapse by position + ore).
- 🔲 **OCR ore-name garble (cosmetic).** Names like `Berylicf)` slip through `cleanOre` on
  noisy scan lines; could snap against the signature table's ore names. `src/core/scan.ts`.

Resolved highlights (in git): OCR off the main thread → Web Worker; 1600px crop cap; windowed
voter; backdrop-blur removed; DirectML backend; production model paths via `extraResources`
(R4.5 packaging); SurveyMap redraw throttle; plausibility-gated survey logging.

### Library candidates (only if they earn it)
- `comlink` (~3 kB) — replace the manual `id`/`pending`-map worker RPC in `ocr.ts`.
- `react-virtuoso` / `react-window` — virtualize scan-results / log lists only if they grow
  to hundreds of rows.
- Explicitly skip: map libs (canvas is fine), OCR libs (locked), CSV libs (hand-rolled export
  is fine). `zustand` is already in (prospect store).

---

## Deferred roadmap (post-v1, not blocking)

- **R1 — Multiple mining methods.** Relax the ship-only filter in the crawl (method is
  already recorded per row); add ROC (Vehicle) + FPS to the method selector (matcher already
  takes a method param); per-method region presets (scan UIs differ). Needs screenshots of
  the other scan UIs.
- **R2 — Browser-only build (optional).** Standalone web entry using `getDisplayMedia`,
  reusing pure `src/core`; no overlay window, results render in-page (second monitor).
- **R3 — Polish.** Lazy live sell price (UEX / SC-Trade), cached with a TTL, **never** on the
  identification hot path. (The old "data update from a user URL" idea is superseded by the
  runtime wiki crawl — see CLAUDE.md runtime-crawl deviation + `electron/tables.ts`.)
- **Survey mode** — feature-flagged off (`features.survey`); full design + its own backlog
  (S1–S5) in `SURVEY-MODE.md`.

---

## Deferred product decisions

- **No code signing (accepted).** `build.win` is `nsis` only; the unsigned installer triggers
  a Windows SmartScreen "unknown publisher" warning. Decision (2026-06-05): not blocking —
  users click through ("More info" → "Run anyway"). Documented in the README. Revisit with a
  cert / Trusted Signing budget.
- **Auto-update: minimum only.** Startup checks GitHub Releases and shows a "new version" link
  (`electron/update.ts`); the user downloads/installs manually. Full auto-install (electron-
  updater + a publish pipeline) is deferred.

---

## Architecture notes (non-obvious decisions)

- **`src/control/prospect/`** — the scan→identify pipeline: a Zustand `store` (runtime
  per-tick state) + pure, tested `rsReading`/`status` modules + presentational components.
  The user-facing tab stays labelled "Mining" (game term); only the implementation is
  "prospect". Zustand earns its keep here (per-tick push, sibling consumers).
- **`src/control/settings/` hooks** (`useAppSettings`/`useOcrEngine`/`useUpdateCheck`/
  `useTables`) — App is a thin shell (load gate + routing + chrome). Settings use a plain
  hook, **not** a store: they go to direct children, change on user action (no per-tick
  re-render need), and persist over 3 IPC channels — a single subscribe→persist store
  doesn't fit.
- **`electron/` modules** — `main.ts` is lifecycle glue only; `windows` (a `createOverlayBox`
  factory for the 3 transparent boxes), `ipc`, `ocr`, `hotkeys`, `settings`, `security`,
  `tables`, `env`, `update` each own one concern.
- **Control UI styling** — Tailwind v4 + Radix/shadcn primitives in `src/control/ui/`; the
  transparent overlay/detail/scan cards stay runtime-inline (`OverlayConfig`-driven) by
  necessity. See the CLAUDE.md sanctioned-deviation notes.

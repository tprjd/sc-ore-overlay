# TASKS.md — remaining build plan

Phases 0–5 are **built** (core matcher + validator, wiki crawl, screen capture + PP-OCR,
matcher wired to UI, transparent overlay + global hotkeys + edit mode, settings/patch
persistence, ore-quality detail box). See `CLAUDE.md` for the domain knowledge and matcher spec,
and git history for how each shipped.

Both v1 human-verification gates passed (2026-06-03) and **v1.0.0 shipped** (ship mining: capture
→ OCR → match → live overlay, confirmed in-game). The **UI/UX** chapter shipped as **v1.1.0**
(Survey feature-flag, overlay polish, panel restructure, setup wizard, status bar + live preview;
commits `U0`–`U4`). **v1.2.0** then dropped the low-value signature echo and added live OCR stats
(confidence / latency / line count / raw text) to the status footer and, behind a toggle, the
overlay card (commits `F1`–`F3`).

What's left below: the **remaining UX items** (Part I) and the **deferred/optional** feature work
(Part II). Read `CLAUDE.md` first — locked stack, guardrails, and matcher spec live there.

Current version: **1.2.0**. Most of the UX chapter has shipped on `main` since v1.2.0 (unreleased) —
see the summary under Part I. Part II (other mining methods) is the next minor/major.

---

# Part I — UX (remaining)

**Shipped since v1.2.0 (unreleased on `main`):** tab restructure to "4 tabs + Results pane"
(Capture · Match · Overlay · Hotkeys; live output pulled into an always-visible Results pane,
T1–T3); preview parity for the detail + scan boxes (`DetailCard` / `ScanCard` extracted, T4);
per-region calibration verdict (A1); header health pill (A3); overlay presets + reset (C1/C2);
overlay change-flash (C3 — ore color-coding dropped, no category data in the table); sortable
scanned-rock card (C4 — SCU/quality/percent, direction + reset). What's left:

## A — Calibration & confidence

### A2 — Setup-wizard confirm-read gate
**Tasks**
- In the wizard's region step, show the live read of the box being drawn and a "looks good?" gate
  before advancing, so a bad crop is caught at setup time.

**Acceptance**
- The wizard won't advance past the region step until a plausible reading is shown (or the user
  explicitly overrides).

## D — Robustness & help

### D1 — Capture-source-lost banner
**Tasks**
- When the capture stream ends (window closed, source lost), show a banner + a reconnect button
  instead of silently freezing.

**Acceptance**
- Closing the captured window surfaces a visible "source lost" state with a one-click reconnect.

### D2 — In-app help / about
**Tasks**
- A help/about surface: hotkey cheat-sheet, the borderless-windowed requirement reminder, and a more
  obvious paused state (dim the preview / badge).

**Acceptance**
- The borderless-windowed requirement and the hotkeys are discoverable in-app without the README.

---

# Part II — Post-v1 roadmap

Bigger feature work beyond shipped v1. Not blocking.

## R1 — Multiple mining methods (deferred from v1)

**Tasks**
- Relax the ship-only filter in the crawl (method is already recorded per row).
- Add ROC (Vehicle) and FPS to the method selector; the matcher already takes a method parameter.
- Add per-method region presets (panel position differs across scan UIs).

**Acceptance**
- Selecting ROC mining matches vehicle-mineable deposits with correct signatures and node counts.

**Human verification:** screenshots of the other scan UIs for region presets.

---

## R2 (optional) — Browser-only build

**Tasks**
- A standalone web entry using `getDisplayMedia` for capture, reusing the pure `src/core` logic.
- No overlay window; results render in the page (suitable for a second monitor).

**Acceptance**
- The web build identifies ores from a shared screen in a normal browser tab.

---

## R3 — Optional polish (unbuilt, low priority)

- "Check for data update" that pulls a newer crawled table from a user-controlled URL.
- Lazy live sell price (e.g. UEX / SC-Trade), cached with a TTL, **never** on the
  identification hot path.

---

## R4 — Native DirectML OCR sidecar (vendor-agnostic GPU OCR) — **priority: high**

**Resolves the OCR-ISSUES.md stall by running OCR on the GPU again — without the contention.**

### Why (the diagnosis this is built on)

The in-renderer WebGPU OCR stalled not because the GPU is weak (a single small PP-OCR crop is
trivial for any modern GPU), but because of **two web-stack weaknesses**:

1. **Chromium serializes WebGPU + the compositor through one GPU process / one command queue.**
   The always-on-top transparent overlay (latency-priority, vsync deadline) starves the OCR
   submissions (best-effort), so OCR latency spikes.
2. **`onnxruntime-web` 1.17.3's WebGPU EP leaks** — the tell is latency that *ramps* run-over-run
   then freezes (a leak signature, not steady contention; see OCR-ISSUES.md).

The current shipped fix sidesteps both by running OCR on **WASM (CPU)** — correct and stable, but it
leaves the GPU idle and a fresh read costs ~1–2 s single-threaded.

**This phase moves OCR onto a native `onnxruntime-node` process using the DirectML execution
provider.** DirectML runs on any DX12 GPU (NVIDIA / AMD / Intel) → **vendor-agnostic**, the stated
requirement. Running it in a separate **Node process with its own D3D12 device** bypasses Chromium's
GPU-process serialization *and* the ORT-web leak entirely — the two root causes both disappear.

> **Sanctioned locked-stack deviation.** CLAUDE.md locks OCR to "@gutenye/ocr-browser on ONNX Runtime
> Web (WASM, in-renderer)" and guardrail #4 forbids a "native OCR binary." This phase deliberately
> amends both, with the human's explicit go-ahead (2026-06-03). The **OCR engine is unchanged** —
> same PP-OCR (`ch_PP-OCRv4_det/rec`) ONNX models; only the *runtime host* moves from the renderer's
> ONNX-Runtime-Web to a native `onnxruntime-node` utility process. Update CLAUDE.md's Locked-stack +
> guardrail #4 to record this so it isn't "fixed" back later. WASM in-renderer stays as the fallback,
> so the locked path is never fully removed.

### R4.0 — Spike / feasibility gate (do this first; STOP if it fails)
**Tasks**
- Standalone Node script (`scripts/ocr-dml-spike.ts`, run with `tsx`): load
  `public/models/ch_PP-OCRv4_det_infer.onnx` + `..._rec_infer.onnx` via `onnxruntime-node` with
  `executionProviders: ['dml']`, read one saved RS crop, print text + confidence + wall time.
- **Confirm the prebuilt `onnxruntime-node` Windows binary actually ships the DirectML EP**
  (`DirectML.dll` + `['dml']` accepted). This is the make-or-break unknown — recent Windows x64
  builds include it, but verify against the pinned version rather than assuming. If `['dml']` is
  rejected by the bundled binary, **STOP and document** the required build/package (e.g. a specific
  ORT distribution) before proceeding.

**Acceptance**
- The spike reads a real crop correctly on a Windows GPU via `['dml']`, with low, *flat* latency
  across N back-to-back runs (no ramp).

**Human verification:** runs on the user's Windows machine (this dev box is WSL/Linux and cannot
exercise DirectML). Provide the script; user reports text + timings.

### R4.1 — Dependencies
**Tasks**
- Add `onnxruntime-node` and `@gutenye/ocr-node` (the Node sibling of `-browser`: onnxruntime-node +
  `sharp` for image decode, same `registerBackend` shape as the current worker). Note the reason in
  the commit (per CLAUDE.md "don't add deps without saying why").
- Remove nothing — the WASM in-renderer worker stays as fallback.

### R4.2 — OCR host (utility process)
**Tasks**
- `electron/ocr-host.ts`, forked from main via `utilityProcess.fork`. Builds a `@gutenye/ocr-node`
  engine with `onnxOptions.executionProviders: ['dml', 'cpu']` (DirectML, CPU fallback inside ORT).
- **Model paths are absolute filesystem paths** handed in by main (Node has no `fetch('/models')`):
  dev → project `public/models`; prod → an `extraResources` dir. Pass them in the `init` message.
- Message protocol mirrors the existing worker so the renderer client barely changes:
  `{type:'init', modelDir}` and `{type:'recognize', id, ...}` → `{id, lines:[{text,score}]}` /
  `{id, error}`. **Serialize jobs** (one ORT session can't run concurrently — same constraint as
  `ocr.worker.ts`).
- **Image transport:** pass raw RGBA bytes + width/height as a **transferable `ArrayBuffer`**, not a
  base64 PNG data URL — avoids a PNG encode/decode on both ends and keeps the hot path cheap. The
  renderer already has the crop in an OffscreenCanvas (`getImageData`).

### R4.3 — Wiring (renderer ↔ utility process)
**Tasks**
- Use **`MessageChannelMain`**: main creates a port pair, hands one to the utility process and one to
  the control renderer (via the preload bridge) so they talk **directly** — image buffers don't bounce
  through main's event loop.
- `src/control/ocr.ts`: add a transport that routes `recognize()` to the utility-process port when the
  active backend is `directml`, and keeps the existing Web Worker for `wasm`. Public API
  (`loadOcr`, `setOcrBackend`, `recognize`) stays the same so call sites
  (`useSurveyCapture.ts`, `scanImage.ts`) are untouched.
- Main: spawn the host on app ready (or lazily on first OCR); restart it if it exits.

### R4.4 — Settings, selection, fallback
**Tasks**
- `OcrBackend` / `AppSettings.ocrBackend`: `'wasm' | 'webgpu' | 'directml'` (`src/shared/bridge.ts`,
  `src/control/ocr.ts`). Keep `webgpu` for the adventurous; document it as unsupported-by-default.
- Selection in `App.tsx` **before any capture starts** (as today). Default preference: **try
  `directml`, auto-fall back to `wasm`** if the host fails to spawn or the EP fails to init — the
  renderer switches transports transparently and surfaces the *effective* backend in the footer /
  OCR-stats line so it's visible which path is live.

### R4.5 — Packaging (electron-builder)
**Tasks**
- `asarUnpack` the native bits: `**/onnxruntime-node/**`, `**/sharp/**` (and `DirectML.dll`) — `.node`
  binaries can't be loaded from inside an asar.
- Ship the PP-OCR models to a real filesystem path via `extraResources` (or unpacked `dist`), and
  resolve that path in main for the `init` message — both dev and packaged.

### R4.6 — Tests, docs, verification
**Tasks**
- `src/core` stays pure — **no change to the matcher/validator**; their tests must still pass
  untouched. Add a host smoke test if practical (Node-side).
- Update **OCR-ISSUES.md** (new `directml` backend; why a separate-process D3D12 device fixes both
  the Chromium serialization and the ORT-web leak; revised Knobs). Update **CLAUDE.md** Locked-stack +
  guardrail #4 to record the sanctioned deviation. Update the **Knobs** + README backend notes.

**Acceptance**
- With `ocrBackend: 'directml'`, the **overlay shown + capture running** no longer stalls: OCR latency
  is low and flat (no ramp to seconds, no freeze), capture rate holds, video stays smooth — the exact
  scenario that broke under in-renderer WebGPU.
- Fresh-read latency is materially below the WASM single-thread ~1–2 s.
- DirectML init failure falls back to WASM with no user-visible breakage; the active backend is shown.
- All existing matcher/validator tests pass unchanged.

**Human verification (mandatory — same class as the Phase 1 / Phase 3 checkpoints):** this dev box is
WSL/Linux and cannot run DirectML or the over-game overlay. The user must confirm on real Windows that
(a) digits read correctly via `directml`, ideally on more than one GPU vendor, and (b) the overlay-up
stall is gone with stable latency. Do not claim it works without those confirmed runs.

---

## Reminders that apply to every item

- Run the acceptance check before continuing.
- Keep the matcher/validator pure and fully tested; if you must change them, add a failing test
  first.
- Honor the guardrails in CLAUDE.md (read-only, wiki etiquette, no stack swaps).
- At the human checkpoints, build the mechanism and then stop and ask — don't fabricate
  verification.

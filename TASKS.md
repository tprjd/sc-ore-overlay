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

## R4 — Native DirectML OCR sidecar (vendor-agnostic GPU OCR) — ✅ DONE

**Shipped on `main` (merge `65284fe`). In-app verified on real Windows hardware** — DirectML reads
correctly, latency flat ~28–33 ms, the overlay-up stall is gone. R4.0–R4.6 all complete.

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

## R5 — Make DirectML the default + add a UI backend toggle — ✅ DONE

**Shipped on `main` (merge `65284fe`), in-app verified.** DirectML is the launch default; the Capture
tab has the backend selector; the status footer shows the active engine (`eng`); WASM auto-fallback
intact. All three tasks complete.

R4's `directml` backend is confirmed working in-app on real Windows hardware
(read correct, flat ~28–33 ms, overlay-up stall gone). Promote it from an opt-in
DevTools knob to the default, with a visible control.

**Tasks**
- **Default to `directml`.** Change the launch default (`App.tsx`, currently
  `s.ocrBackend ?? 'wasm'`) to `'directml'`. The native host already auto-falls
  back to the WASM worker if it can't start or DirectML init fails, so non-DX12 /
  broken-driver machines stay safe. Update CLAUDE.md + OCR-ISSUES.md to say the
  default is now `directml` (wasm = fallback).
- **UI toggle.** Add an OCR-backend selector in the control window (Capture tab,
  near the Timing controls — same area as `quorum`/`interval`/`scale`). Options:
  `DirectML (GPU)` / `WASM (CPU)` / `WebGPU (experimental)`. Persist via
  `setSettings({ ocrBackend })`. Note that a change needs a relaunch (the engine
  is chosen once before capture) — show that hint inline, or trigger a relaunch.
- **Surface the effective backend.** The selected backend may differ from the
  active one (directml → wasm fallback). Plumb the resolved transport out of
  `src/control/ocr.ts` (it already logs it) and show it in the status footer /
  OCR-stats line so the user sees which path is actually live.

**Acceptance**
- Fresh install defaults to DirectML and reads on the GPU with no manual setting.
- The toggle switches backend (after relaunch) and persists across restarts.
- On a machine without a usable DX12 device, the default still works (falls back
  to WASM) and the footer shows `wasm`.

---

## R6 — Overlay presence & staleness: only show real reads, hold then drop, vanish on source loss — ⏳ BUILT, pending in-game verification

**Status (2026-06-03):** all sub-tasks implemented on `main`; `npm run typecheck`, `npm run
build`, and the 115-test suite pass (new: `isExpired` + strict `parseScanResult` negatives).
Mechanisms only — the over-game behavior (hold-then-clear, empty scan box, vanish-on-loss)
still needs the human checkpoint below on real Windows + live HUD before R6 is marked done.

**Problem.** Three failure modes leak garbage onto the overlay:

1. **Stale lock never clears.** The temporal voter latches `stable` and is *sticky* —
   it only changes when a *different* value reaches quorum (`voteStep`,
   `src/core/validator.ts`). When the RS chip leaves the screen (no signature shown),
   no new value ever reaches quorum, so the last ore stays on the overlay forever. The
   idle fade (`idleMs`) only lowers *opacity*; the value underneath is still latched and
   snaps back to full on the next unrelated tick.
2. **Scan box shows garbage when SCAN RESULTS isn't on screen.** `parseScanResult`
   (`src/core/scan.ts`) takes the *first text line with a letter* as the ore name. With
   the panel absent, the scan region OCRs whatever HUD junk sits there and emits a bogus
   `ScanResult`, which freezes into `frozenScan` and ships to the scan overlay box.
3. **Source loss leaves a frozen overlay.** If the shared screen/window goes away (track
   ends, capture stalls), the last payload stays on the overlay indefinitely.

**Goal.** The overlay reflects *what is currently on screen*: it shows the matched ore
only while a valid RS read is fresh, **holds** the last ore briefly (configurable) when
the read drops, then clears; the scan box appears **only** when a real SCAN RESULTS panel
is detected; and the whole overlay **disappears** when the capture source is lost.

These three are independent — implement and test each on its own.

### R6.1 — Confidence gate on reads
**Tasks**
- Add a minimum OCR-confidence threshold for accepting a reading. Reads below it are
  treated as *no reading* (fed to the voter as `null`), not as a candidate. PP-OCR scores
  run high (see `confColor` in `ScanView.tsx`: ≥90 good, <70 bad) — default the gate low
  (e.g. ~0.6) so it only kills clear garbage, and make it a tuning setting
  (`AppSettings`/`LoopParams`, Capture → Tuning).
- The gate lives in the read pipeline (where `pickReading`/`useSurveyCapture` produce the
  RS value), so a low-confidence frame becomes `null` *before* voting. Keep `src/core`
  pure: pass the score + threshold in; don't read settings inside core.

**Acceptance**
- A low-confidence frame does not move the voter; an existing stable read holds (subject to
  R6.2 expiry) rather than flipping to a garbage value.

### R6.2 — Hold-then-drop for the RS reading (staleness expiry)
**Tasks**
- Add `holdMs` to `OverlayConfig` (`src/shared/bridge.ts`, with a default — e.g. 4000) and
  a control in the **Overlay** settings tab (dropdown like `idleMs`: e.g. 2s / 4s / 10s /
  Never). Document it as distinct from `idleMs`: `holdMs` drops the *value*; `idleMs` fades
  the *opacity*.
- Track the timestamp of the last **valid** RS reading (passed the R6.1 gate + plausible).
  When `now − lastValid > holdMs`, clear the stable reading: reset the voter and set
  `stableRs = null` so `matches` empties and the overlay clears the ore. `holdMs = 0`/Never
  keeps today's sticky-forever behavior.
- Implement in the read/vote owner (`ScanView.tsx`, around the `voter.current.push` effect).
  Prefer a small pure helper in `src/core` (e.g. `isExpired(lastValidTs, now, holdMs)` or a
  reducer extension) so it's unit-testable; keep the wall-clock/`setTimeout` in the
  component. Do **not** bake hold logic into `voteStep` (it must stay a pure reducer of
  readings) unless you extend it with an explicit timestamp input and test that.
- Note interaction: a static/unchanged frame currently re-votes `lastValue.current` to keep
  a still image latched. Ensure "RS chip gone" reads as `null` (no digit token / failed
  gate), which is the expiry trigger — not as an unchanged frame that keeps the value alive.
  Verify the unchanged-frame skip path doesn't defeat the hold timer.

**Acceptance**
- RS chip leaves screen → ore stays for ~`holdMs` → then the overlay clears (no value, not
  just faded).
- RS chip returns within `holdMs` → no flicker, the reading stays continuous.
- `holdMs = Never` reproduces current sticky behavior. Matcher/validator unit tests still
  pass; new expiry helper has its own tests (fresh, just-expired, boundary, Never).

### R6.3 — Scan box only when SCAN RESULTS is really present
**Tasks**
- Gate `parseScanResult` (`src/core/scan.ts`) on actual panel presence instead of
  "first line with a letter." Require structural evidence, e.g. the **SCAN RESULTS** header
  token detected (fuzzy-tolerant for OCR) **and/or** ≥1 real signal (a `MASS:` label, a SCU
  total, or ≥1 composition row). Return `null` when the evidence is absent so junk HUD text
  never becomes a `ScanResult`. Keep it pure; add a `requireHeader`/strictness option if a
  looser mode is still wanted elsewhere.
- Optionally also apply the R6.1 confidence gate to the scan region.
- In `ScanView.tsx`, only set/keep `frozenScan` when the parse is non-null; clear
  `frozenScan` (→ scan box hides) once the panel is gone for `holdMs` (reuse R6.2 expiry),
  so the scan box follows the same hold-then-drop rule as the RS reading.

**Acceptance**
- With the scan region pointed at the HUD but **no** SCAN RESULTS panel up, the scan
  overlay box shows nothing (no garbage ore/composition).
- A real panel still parses (existing `scan` tests pass; add a negative test: junk lines →
  `null`, and a partial-panel case).

### R6.4 — Hide the overlay when the capture source is lost
**Tasks**
- Detect source loss in the control window: `MediaStreamTrack` `ended`/`mute` events on the
  captured stream, the `<video>` element erroring/stalling, or no fresh frame for a
  threshold (e.g. the preprocess hash unchanged **and** the track unhealthy — distinguish a
  paused-but-alive game from a dead source). Centralize in the capture owner
  (`App.tsx`/`useSurveyCapture`/`ScanView.tsx`).
- On loss: stop pushing matches, clear the voter + `frozenScan`, and tell the overlay to
  **disappear entirely** (not just fade). Add an explicit signal — either a payload flag
  (e.g. `sourceLost: true` on `OverlayPayload`) or reuse the existing hide channel
  (`onToggleVisible`/a dedicated `setOverlayVisible`) — and have `Overlay.tsx` force
  `visible = false` while lost, independent of `idleMs`/content.
- Reflect the lost state in the control header health pill (it currently hard-codes
  `source ✓`; make it show source lost/reconnect).
- On reconnect (source re-selected or track live again), resume normally.

**Acceptance**
- Killing/closing the shared source makes the overlay vanish within ~1s.
- Reconnecting the source brings readings + overlay back with no restart.
- The control header shows the lost/reconnect state rather than a false `source ✓`.

### R6.5 — Tell the user *why* nothing shows (don't fail silently)
**Problem.** With R6.1–R6.4, the overlay correctly goes blank on garbage / low-conf /
expired / lost-source — but a silent blank looks like a broken app. The user must be able to
tell *why* there's nothing: bad read vs. waiting vs. source gone.

**Tasks**
- **Control window (primary).** Make the Results hero + status footer name the current
  reason explicitly. Today the footer `voterState` is only `paused|settling|locked|idle`
  and the hero shows "no match" / "waiting…". Extend the derived state to distinguish:
  - `low conf` — reads arriving but below the R6.1 gate (rejected garbage). Show the live
    conf% next to it so the user sees it's *reading something*, just untrusted.
  - `stale / held` — was locked, RS read dropped, inside `holdMs` (ore still shown, on
    borrowed time). Optionally a countdown/“holding…”.
  - `expired` — `holdMs` elapsed, value cleared (this is *why the overlay is now empty*).
  - `no scan panel` — RS may be fine but SCAN RESULTS isn't detected (explains the empty
    scan box specifically; R6.3).
  - `source lost` — capture dead (R6.4); the header pill already gets this, mirror it here.
  The footer already surfaces `conf` + `raw` OCR text — keep that so the user can see the
  garbage that's being rejected.
- **Overlay (secondary, opt-in).** When `showPlaceholder` is on, replace the blank with a
  short reason chip instead of nothing — e.g. `low signal`, `no RS`, `source lost` — so the
  user glancing at the game (not the control window) still gets a cause. Keep it tiny and
  faded; respect `idleMs`. When `showPlaceholder` is off, stay fully blank (current behavior).
- Thread the reason from the read pipeline (gate result, expiry, scan-gate, source-lost)
  rather than re-deriving in two places — a single `status`/`reason` enum passed to both the
  control UI and the overlay payload (`OverlayPayload`).

**Acceptance**
- Pointing the RS region at junk → control shows `low conf` + the rejected raw text + conf%,
  not a silent blank, and the overlay (if placeholder on) shows a `low signal` chip.
- After `holdMs` with no read → control footer reads `expired` and the hero explains the
  overlay is empty because the reading went stale.
- Source killed → both control header and footer say `source lost`.

### R6.6 — Tests, docs
**Tasks**
- Unit-test the new pure pieces: expiry helper (R6.2) and the stricter `parseScanResult`
  gate (R6.3). `src/core` stays pure; matcher/validator tests unchanged.
- Document the new knobs (`holdMs`, confidence threshold) in the Knobs section + README:
  what they do and how they differ from `idleMs`.

**Acceptance**
- All existing tests pass; new tests cover expiry + scan-gate negatives.

**Human verification:** this dev box can't run the over-game overlay. After build, the user
confirms on real Windows + live HUD: (a) ore holds then clears when the RS chip leaves; (b)
the scan box stays empty with no SCAN RESULTS panel up; (c) the overlay vanishes when the
captured window is closed and returns on reconnect. Do not claim these work without confirmed
in-game runs.

---

## Reminders that apply to every item

- Run the acceptance check before continuing.
- Keep the matcher/validator pure and fully tested; if you must change them, add a failing test
  first.
- Honor the guardrails in CLAUDE.md (read-only, wiki etiquette, no stack swaps).
- At the human checkpoints, build the mechanism and then stop and ask — don't fabricate
  verification.

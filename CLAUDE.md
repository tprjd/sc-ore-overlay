# CLAUDE.md

You are building **SC Ore Overlay** from scratch. This file is your operating guide: the locked
stack, the verified domain knowledge you must build on, and the guardrails. The phased build plan
with acceptance criteria is in **`TASKS.md`** — follow it phase by phase, run each phase's
acceptance check, and stop at the human-verification checkpoints before continuing.

There is no starter code in this repo by design. You write all of it.

---

## What you're building

A non-obstructive desktop overlay for Star Citizen ship mining. It captures a shared screen, reads
the **Radar Signature (RS)** number off the mining scanner HUD from a user-defined region, identifies
which ore the reading corresponds to, and displays the ore name + node count on a transparent,
always-on-top, click-through overlay while the user plays.

**v1 scope: ship mining only.** ROC/FPS mining is deferred (see TASKS.md Phase 5).

---

## Locked stack — do not substitute

- **Language:** TypeScript (strict mode).
- **Shell:** Electron. This is non-negotiable — it's the only practical way to get a click-through,
  always-on-top overlay over a game plus Chromium screen capture in one app.
- **UI:** React. **Styling:** Tailwind CSS v4 (`@tailwindcss/vite`) + a small set of hand-rolled
  shadcn-style primitives in `src/control/ui/` (Button/Card/Badge/Select/Dialog/Tooltip/Stepper/
  Field, built on Radix + `class-variance-authority`/`clsx`/`tailwind-merge`, icons from
  `lucide-react`). See the sanctioned-deviation note below — this replaced the old inline-style
  `tokens.ts` system across the **control window** so there is one styling system, not two.
- **OCR:** **PP-OCR** (PaddleOCR detection + recognition models) via **@gutenye/ocr-browser** on
  ONNX Runtime Web (WASM, runs in the renderer). The user draws a *rough* region; PP-OCR's text
  **detection** localizes the digits inside it (ignoring the pin icon / padding) and **recognition**
  reads the **raw color** text on any background — no binarization or threshold tuning. The detected
  line whose whitespace token holds the most digits is taken as the reading (see `bestReading`).
  (Chosen after both Tesseract.js and a small TrOCR model misread the stylized HUD font and broke on
  imperfect crops; PP-OCR verified reading "17,080" at 0.99 on sloppy real crops. The RS number is
  always white but the chip background color varies — PP-OCR handles that natively. Models are
  bundled under `public/models`.)
- **Bundler/dev:** Vite (with a Vite↔Electron integration plugin).
- **Tests:** Vitest.
- **Packaging:** electron-builder (target Windows; Star Citizen is Windows-only).

Do not introduce a different UI framework, a native OCR binary, a cloud OCR service, or a different
overlay mechanism. OCR is locked to **PP-OCR via @gutenye/ocr-browser on ONNX Runtime Web** (WASM,
in-renderer) after Tesseract.js and a small TrOCR model both proved unreliable on the HUD font. If
you believe a locked choice genuinely cannot work, stop and flag it rather than swapping silently.

> **Sanctioned deviation (2026-06-03, TASKS.md R4):** OCR may also run on a **native
> `onnxruntime-node` + DirectML** backend in an Electron `utilityProcess` (`electron/ocr-host.ts`),
> selected by `ocrBackend: 'directml'`. This amends "no native OCR binary" / the WASM-in-renderer
> lock **with the human's explicit approval**, to get vendor-agnostic GPU OCR (any DX12 GPU) without
> the overlay-vs-WebGPU contention documented in OCR-ISSUES.md. The **OCR engine is unchanged** —
> same PP-OCR (`ch_PP-OCRv4_det/rec`) models; only the runtime *host* moves out of the renderer. The
> WASM-in-renderer path remains the automatic fallback, so the locked path is never removed. Do
> **not** "fix" this back to web-only.
>
> **R5 update:** `directml` is now the **launch default** (selectable in the Capture tab; the active
> engine shows in the status footer). It auto-falls back to the WASM worker when the native host
> can't start, so non-DX12 machines stay safe.

> **Sanctioned deviation (2026-06-06, onboarding redesign):** the control-window UI was migrated
> from inline-style design tokens to **Tailwind CSS v4 + a small Radix/shadcn-style primitive set**
> (`src/control/ui/`), **with the human's explicit approval**, so the app has one styling system.
> This adds a CSS tool + component primitives on top of React — it does **not** change the UI
> framework (still React) or any locked OCR/overlay choice. Constraints that must hold: (1) the
> Tailwind stylesheet (`src/control/ui/theme.css`) is imported **only** by `src/control/main.tsx`, so
> the transparent overlay/detail/scan windows never load it and keep their **runtime-inline,
> `OverlayConfig`-driven** appearance — those cards are a deliberate exception, not a second design
> system; (2) `theme.css` mirrors the old palette and is excluded from Biome (its `@theme`/`@import
> "tailwindcss"` isn't standard CSS); (3) `@tailwindcss/vite` is ESM-only and `vite.config.ts` is
> CJS, so the plugin is loaded via a dynamic `import()` in an async config. Do **not** reintroduce a
> parallel inline-token system for the control UI.

> **Sanctioned deviation (2026-06-06, runtime crawl):** the signature table may now be **crawled at
> runtime**, not only at build time, **with the human's explicit approval** — patch-to-patch signature
> changes are small and shouldn't require a new app build. The crawl logic is shared
> (`src/core/crawl.ts`, framework-free, caller-injected `get`): the build-time CLI
> (`scripts/crawl-wiki.ts`) writes the **bundled fallback** under `src/data/tables/`, and the Electron
> **main process** (`electron/tables.ts`) crawls into `<userData>/tables/<patch>.json` via `net.fetch`
> on first launch, when a newer game patch is detected at startup, or on a manual "Refresh ore data"
> button. The renderer seeds from the bundled tables (so it works offline) and overlays the crawled
> ones, preferring a crawled table per patch (`useTables`). This **amends guardrail #2** ("build-time
> crawl only") but the rest of that guardrail still binds: descriptive User-Agent, sequential
> throttled requests, **never on the per-scan hot path** (crawl is infrequent + background, never
> blocks launch, partial/empty crawls never overwrite a good table). The read-only guardrail (#1) is
> unchanged — this is still public-data lookup, never game memory/injection. Do **not** "fix" this
> back to build-only.

---

## Verified domain knowledge (build on this — it was confirmed against the live API)

### 1. The identification mechanic
The scanner HUD shows a **total RS value** that equals one deposit's base signature times the number
of rocks (nodes) in the cluster:

```
total_RS = deposit_signature × node_count
```

Example: an Iron deposit's signature is **4270**, so a reading of **21350** is `4270 × 5` → Iron,
5 nodes. Identification is therefore **constrained division**, not text recognition of a name.

### 2. The data source: Star Citizen Wiki API (two-step crawl, build-time only)
```
List:   GET https://api.star-citizen.wiki/api/commodities          (paginated)
Detail: GET https://api.star-citizen.wiki/api/commodities/{uuid}
```
Crawl the list, keep mineable commodities (`is_mineable === true`), then fetch each detail.

**CRITICAL — the signature you want is nested, not top-level:**
- `data.signature` is the **commodity-level** value (e.g. Iron = **4700**). **This is NOT what the
  scanner shows.** Keep it only for an optional calibration check.
- `data.locations[].resources[].signature` is the **per-deposit** value (e.g. Iron = **4270**).
  **This is the value the scanner shows and the one identification uses.**

Each resource also carries:
- `label` — the ore name (e.g. "Iron").
- `clustering` — `min_size`, `max_size`, and a `params` list of `{min_size,max_size,relative_probability}`
  buckets. This gives the **valid node-count range** and per-size probability for that deposit.
- `materials` — composition (percentages), not needed for v1 identification.

`data.methods` (e.g. `["Ship"]`), `data.systems`, and per-location `group_probability` are also present.

> Never call the wiki API on the per-scan hot path. Throttle, set a User-Agent, cache. Re-crawl per
> game patch (signatures/clustering change between patches) — this now happens at runtime too, not
> just at build time (see the runtime-crawl sanctioned deviation in the Locked stack section).

### 3. The clustering constraint — this is what makes identification tractable
Don't accept "any multiple of a signature." A candidate ore is valid only when the signature divides
the reading cleanly **and** the resulting node count falls inside that deposit's `min_size..max_size`.
This kills most false matches. Use the per-size `relative_probability` to rank candidates.

### 4. Overlapping signatures are real → show multiple candidates
Different ores can share a signature, or one reading can divide two ways. When more than one ore
qualifies, the overlay shows **both** (top-scoring first), each with its own node count. Never
silently guess one.

### 5. The matcher spec (implement and unit-test this exactly)
Pure function. Input: a validated integer reading. Output: ranked candidates.
```
matchOre(reading, table, opts, context):
    for each deposit in table:
        if opts.method not in deposit.methods: skip            # v1: "Ship"
        if context.location set and deposit doesn't spawn there: skip
        n = round(reading / deposit.signature)
        if n < 1: skip
        relErr = |reading - n*deposit.signature| / reading
        if relErr > opts.relTol (default 0.002): skip          # must divide cleanly (exact divisor wins; ~0.35%-apart neighbours excluded)
        if n < cluster.min_size or n > cluster.max_size: skip  # valid cluster size
        score = (1 - relErr) * clusterProb(deposit, n) * (locationProb if context.location else 1)
        emit { name, nodes: n, score }
    merge by ore name (keep best score), sort by score desc, return ALL qualifying
```
The matcher is the crown jewel and the most testable part — write thorough unit tests for it first
(Phase 0). Cover: clean match, overlap → two results, cluster-min and cluster-max rejection,
location filter, method filter, OCR-jitter tolerance, and no-match.

---

## Target architecture (you create these; names are guidance, not law)

- **`electron/`** — main process (control window + transparent overlay window, global hotkeys,
  `desktopCapturer` source enumeration) and a preload that exposes a typed, sandboxed bridge.
- **`scripts/crawl-wiki.*`** — the build-time CLI wrapper around the shared crawl
  (`src/core/crawl.ts`) → a compact signature table (one row per distinct `material + signature +
  cluster range`, locations merged) committed under `src/data/tables/` as the **bundled fallback**.
  The same `src/core/crawl.ts` is reused at runtime by `electron/tables.ts` (crawl into userData; see
  the runtime-crawl deviation), and `src/control/settings/useTables.ts` merges bundled + crawled.
- **`src/core/`** — pure, framework-free logic: data types, the matcher, a validator
  (plausibility + N-frame temporal voting to kill OCR flicker), table loader + location grouping.
  Plus renderer-only helpers: a crop+upscale step (`src/control/preprocess.ts`) and the OCR wrapper
  (`src/control/ocr.ts`, PP-OCR via @gutenye/ocr-browser). PP-OCR reads the raw color crop and
  localizes the digits, so no binarization is needed; `bestReading` in `src/core/parse.ts` picks the
  digit run from the detected lines.
- **`src/control/`** — control window UI: capture-source picker, region picker (drag a box, store
  **normalized** 0..1 coords), location dropdown (System → location, plus "Anywhere"), and the loop
  that ties capture → preprocess → OCR → validate → match → push-to-overlay.
- **`src/overlay/`** — the transparent overlay: renders `ORE ×N`, stacks both on overlap, fades when idle.
- **`test/`** — Vitest specs, matcher first.

Overlay window must be: `transparent`, frameless, `alwaysOnTop`, `skipTaskbar`, non-focusable, and
click-through (`setIgnoreMouseEvents(true, { forward: true })`) except in an explicit "edit overlay"
mode. Capture frames ~every 0.5–1s (not 60fps); skip OCR when the cropped region is unchanged.

---

## Guardrails (hard rules)

1. **Read-only.** Screen capture + public-data lookup only. **Never** read game memory, inject into
   the game process, hook input, or automate gameplay. If a task seems to need that, stop and flag
   it — the whole design avoids it for anti-cheat and ToS reasons.
2. **Wiki API etiquette.** Throttled, with a User-Agent, **never on the per-scan hot path**. (Crawl
   is no longer build-time-only — see the 2026-06-06 runtime-crawl sanctioned deviation above; the
   etiquette here still binds for both the build-time and runtime crawls.)
3. **Borderless windowed requirement.** Click-through overlays don't draw over exclusive
   fullscreen; the app assumes Star Citizen runs borderless/windowed. Document this for the user.
4. **No silent stack changes** (see Locked stack).

## Two human-in-the-loop checkpoints — build, then STOP and ask

These cannot be completed autonomously. Build the mechanism, then request what you need:
- **OCR verification (Phase 1):** PP-OCR needs no threshold tuning, but reads must be confirmed on
  the user's real HUD. Build the debug view, then ask the human for real screenshots / an in-app run
  and confirm all digits 0–9 read correctly across background colors. Do not claim it works without
  confirmed reads on real images.
- **Overlay-over-game behavior (Phase 3):** always-on-top + click-through over a running game is
  OS/version sensitive. Implement it, then ask the human to confirm in-game and note any
  platform-specific tweaks.

Surfacing these is correct, not failure. Never fabricate screenshots or pretend to have verified
in-game behavior.

---

## Working conventions

- Implement **phase by phase** per `TASKS.md`; small, reviewable commits aligned to phases.
- TypeScript strict; keep `src/core` pure (no Electron/DOM globals except the documented
  renderer-only OCR/preprocess helpers).
- Don't add dependencies without saying why.
- When the live wiki response shape differs from the notes above (e.g. exact pagination), adapt to
  the real response and note what changed — don't guess silently.
- `npm install` and the crawl need network; if the environment blocks it, say so and ask the human
  to run those steps rather than hardcoding fake data.

## Definition of done (v1)

App captures a shared SC screen; the user draws the RS region and picks a location; the transparent
overlay shows the matched ore name(s) + node count, updating live, without stealing focus or
obstructing play. Ship mining only.

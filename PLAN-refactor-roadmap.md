# Refactor Roadmap

Status: proposed · Branch: `release/1.0.0-rc.1` · Author: David + Claude

Grounded inventory of remaining refactor targets after the ScanView → prospect split,
ranked by value. Sizes are current line counts.

## Ranked targets

| # | File(s) | Lines | Verdict | Why |
|---|---|---|---|---|
| 1 | `src/control/App.tsx` | 411 | **refactor** | Settings god component: ~20 `useState`, a 60-line imperative restore effect, **5 scattered persist effects**, and 4 unrelated concerns (update banner, OCR backend, source/reconnect, wizard) tangled in one body. |
| 2 | `electron/main.ts` | 614 | **refactor** | Biggest file; `createOverlay/Detail/ScanWindow` are ~90% duplicate, and settings I/O + hotkeys + OCR host + update + CSP all live together. |
| 3 | `SurveyView` / `SurveyMap` / `ScanResults` | 588 / 374 / 198 | **refactor** | The survey trio — same recipe as prospect (store + pure + components). Gated off, so lower stakes. |
| 4 | `ProspectSettings.tsx` | 581 | optional | Large but cohesive + isolated; could split per-subtab (Capture/Match/Overlay/Hotkeys). |
| 5 | `SetupWizard.tsx` | 597 | optional | Large but cohesive; could split per-step components. |
| – | `bridge.ts` (345), `useSurveyCapture` (331), `matcher` (274), overlay cards (~310) | – | **leave** | Appropriately sized for what they are; dense but cohesive + well-commented. |

Recommended order: **App.tsx → main.ts → survey trio** → (optional polish).

---

## Plan A — `App.tsx` ✅ done (2026-06-06)

Implemented as 3 hooks under `src/control/settings/`: `useAppSettings` (restore + persist +
all setting state + the side-effecting setters), `useOcrEngine` (apply core backend +
resolve effective), `useUpdateCheck` (transient release check). App 411 → 235 (rest is
layout/routing). No store — a hook fits (see note below). Source/reconnect stayed in App
(intertwined with routing). typecheck + biome ci + 148 tests + build green.

> **Store vs hook:** used a plain hook, not Zustand. Settings go to App's *direct* children
> (already props, no deep drilling), change on user action (not per-tick, no re-render perf
> need), and persist over 3 different IPC channels (setSettings / setHotkeys /
> setOverlayConfig) — so a single subscribe→persist store doesn't fit. The prospect store
> earned its keep (per-tick push, sibling consumers); this doesn't.

### Original plan

### Goal
App becomes a thin shell: load gate, top-level routing (wizard → source picker →
mining/survey), and the update banner + tab chrome. All settings ownership, restore,
and persistence move into one hook; the self-contained concerns move into their own
hooks. Behavior-preserving.

Target: ~411 → ~150 lines.

### Extract

**`src/control/settings/useAppSettings.ts`** — owns the persisted control settings.
- Holds the setting state currently in App: `miningRegions`, `noiseSignatures`,
  `enforceCluster`, `location`, `params`, `activePatch`, `hotkeys`, `overlayConfig`,
  `surveyRegions`, `surveyScout`, `surveyEnabled`, plus `loaded`.
- Does the one-time **restore** (the big effect → a pure `applySettings(raw)` mapper +
  the legacy single-region migration) and exposes `setupComplete`/`hasRegions` so App
  decides the wizard.
- Centralizes **persistence**: replace the 5 ad-hoc effects with one effect that, after
  `loaded`, sends a single merged patch when any slice changes (or a tiny per-slice
  `persist(key, value)` helper). One place to add a new persisted field.
- Returns `{ settings, setX..., loaded, setupComplete }`. (Internally this can be a small
  Zustand store with a single `subscribe → window.sco.setSettings(patch)` — consistent
  with the prospect store and removes the effect-soup entirely. Decide at build time.)

**`src/control/settings/useUpdateCheck.ts`** — the GitHub-release banner concern.
- Owns `update`, `dismissedUpdate`; runs the one-shot check after `loaded`; exposes
  `{ showUpdate, update, dismiss }`. Persists `dismissedUpdate` itself.

**`src/control/settings/useOcrBackend.ts`** — OCR engine selection.
- Owns `ocrBackend` + `effectiveBackend`, the `setOcrBackend(core)` side-effect, and
  persistence; exposes `{ ocrBackend, effectiveBackend, setBackend }`.

**`src/control/useCaptureSource.ts`** (optional, nice) — `source`, `autoReconnect`,
`lastSource`, and `handlePick`/`handleReconnect`/`handleBack`. Returns the source +
actions. Keeps the stream-teardown logic in one place.

### App after
- Calls the hooks, derives `table`/`patches`, owns only `tab` + `showWizard` (routing).
- `completeSetup`/`skipSetup` stay (they coordinate several hooks) but read/write through
  the hooks' setters.
- Render: load gate → wizard → source picker → `<div>` shell (update banner, tab bar,
  `ProspectView`/`SurveyView`).

### Risks
- **Restore-before-persist ordering**: the `loaded` gate must stay — persistence only
  after restore, or it clobbers saved settings with defaults. Keep `loaded` owned by
  `useAppSettings` and gate all writes on it.
- **`setParams` functional merge** + the legacy `s.region` migration must be preserved
  verbatim (move into `applySettings`).
- **OCR backend must be set before capture starts** — `useOcrBackend` runs its
  `setOcrBackend(core)` synchronously on restore, same as today.
- Overlay-config echo (`onOverlayConfig` → setState without re-send) must not loop —
  keep the "update state only" rule.

### Verify
- typecheck + `biome ci` + `npm test` green.
- `npm run dev`: fresh profile → wizard; returning profile → restores every setting;
  changing each setting persists across relaunch; update banner; OCR-backend switch;
  source pick / reconnect / back — all identical.

### Commits
1. `useUpdateCheck` + `useOcrBackend` (small, self-contained) → App uses them.
2. `useAppSettings` (restore + persist + setting state) → App uses it.
3. (optional) `useCaptureSource`. Final: App is the thin shell.

---

## Plan B — `electron/main.ts` ✅ done (2026-06-06)

Split into modules: `env` (paths), `settings` (userData I/O + `patchSettings`),
`windows` (a `createOverlayBox` factory replaces the 3× duplicate creators + refs +
edit-mode), `ocr` (host client + IPC + kill), `hotkeys` (apply/register + IPC),
`ipc` (core handlers), `security` (nav hardening + CSP). `main.ts` 614 → 52 (lifecycle
glue). All 18 IPC channels intact. typecheck + biome ci + build green.

### Original sketch

- `electron/windows.ts`: `createControlWindow()` + a `createOverlayBox({ name, defaults,
  boundsKey })` factory that the overlay/detail/scan windows all use (transparent,
  frameless, click-through, alwaysOnTop, skipTaskbar, non-focusable + the debounced
  bounds-persist). Removes the 3× duplication.
- `electron/settings.ts`: `readSettings`/`writeSettings` + the survey-log I/O (already
  similar shape).
- `electron/ipc.ts`: register the `sco:*` handlers (get/set settings, reset, matches,
  overlay-config, resizes, survey log, updates, open-external/logs).
- `electron/hotkeys.ts`: `applyHotkeys` + handlers + `setEditMode`.
- `main.ts` shrinks to: app lifecycle (`whenReady`/`activate`/`will-quit`), CSP install,
  and calling the modules. Behavior-preserving; pure module extraction.

---

## Plan C — Survey trio (later)

Same recipe as prospect: a `survey` store (or reuse patterns), pure helpers where logic
exists (the map projection/fit is already mostly pure in `core`), and split
`SurveyView` into Live-readout / Log / Map / Sim / Regions panels. Gated off, so it can
trail the others.

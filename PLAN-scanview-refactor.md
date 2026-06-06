# Plan — ScanView Refactor (→ Prospect feature + Zustand)

Status: proposed (v2) · Branch: `release/1.0.0-rc.1` · Author: David + Claude

## Goal

`src/control/components/ScanView.tsx` (~1080 lines) does too much: capture-loop wiring,
the RS temporal-voting state machine, source-lost detection, scan-freeze, overlay-push
IPC, hotkey commands, *and* the full settings panel UI.

Split it into a small **Zustand store** (runtime scan-pipeline state) + **pure transition
functions** (unit-tested) + focused presentational components, under a feature folder
named **`prospect`** (the act of scanning the HUD's Radar Signature and identifying ore —
"mining" is the game activity, not what this code does).

**Behavior-preserving.** No feature/UX changes, no IPC changes, no styling changes
(classNames copied verbatim). The wins: the orchestrator drops to ~250 lines, the
voting/status logic becomes pure + tested, and components subscribe to store slices
instead of receiving ~30 props (kills the prop-drilling the v1 plan flagged).

## Decisions (from Q&A)

- **Feature name:** `prospect`. Folder `src/control/prospect/`; component `ProspectView`
  replaces `ScanView`. The user-facing tab stays labelled **"Mining"** and the App tab
  key stays `'mining'` (game term) — only the *implementation* is renamed. Note in code.
- **State:** **Zustand** (`zustand`, ~1KB, new dep — network install). One store for the
  runtime pipeline; pure transition fns run *inside* store actions so they stay testable.
- Distinct from `core/scan.ts` / `ScanCard` / `ScanResults`, which parse the in-game
  **SCAN RESULTS** rock-composition panel — different concept, keep those names.

## Non-goals

- No changes to `core/`, `electron/`, OCR, the matcher, or the overlay cards.
- No restyle (markup/classNames identical).
- `SurveyView` untouched here (same shape, gated off — separate follow-up).
- **Settings stay App-owned/props.** Location, noiseSignatures, enforceCluster, params,
  overlayConfig, hotkeys, patch, ocrBackend are *persisted* by App. They go to one
  `ProspectSettings` component as props (one hop, fine) — the store is runtime-only, so
  persistence and the tick-rate state don't entangle. (Group into a `settings` object if
  the signature gets unwieldy.)

## Target layout

```
src/control/prospect/
  store.ts            # Zustand: useProspectStore — runtime pipeline state + actions
  rsReading.ts        # PURE: nextReadingState() voting/hold/expire transition + types
  status.ts           # PURE: deriveOverlayStatus(), deriveHealth(), STATUS_META
  useSourceLost.ts    # hook: track-ended/readyState polling → store.setSourceLost
  ProspectView.tsx    # orchestrator (was ScanView): wires capture loop → store, layout
  ProspectResults.tsx # presentational: hero reading + overlap candidates + no-match
  ProspectSettings.tsx# presentational: subtab bar + Capture/Match/Overlay/Hotkeys/About
  ProspectStatusBar.tsx # presentational: footer status strip
```

`App.tsx` imports `ProspectView` instead of `ScanView` (same props). `components/ScanView.tsx`
is deleted.

## The store (`store.ts`)

`useProspectStore = create<ProspectState>()((set, get) => ({ ... }))`.

**Reactive state** (what components select):
- `stableRs`, `settling`, `readState`, `tickRate`, `sourceLost`, `frozenScan`, `paused`.

**Non-reactive internals** (held in the store, never selected → never re-render):
- `voter` (the `createVoter` instance — mutated, not replaced), `lastValidAt`,
  `hadReading`, `tickTimes` (rolling window for tickRate).

**Config snapshot** (set by the orchestrator when params change): `quorum`, `minConf`, `holdMs`.

**Actions:**
- `configure({ quorum, minConf, holdMs })` — recreates the voter when `quorum` changes.
- `pushReadout(readout, now)` — calls pure `nextReadingState(...)`, updates stableRs/
  settling/readState + lastValidAt/hadReading; updates the rolling `tickRate`.
- `pushScan(scan, oreVocab, now)` — snap + freeze + hold-drop → `frozenScan`.
- `setSourceLost(boolean)`, `setPaused(boolean)` / `togglePause()` (clears tickTimes on pause),
  `recalibrate()` (clear frozenScan; region clearing is done by the orchestrator via props),
  `reset()` — full reset, called on `ProspectView` unmount (single module-singleton store).

Components read with narrow selectors, e.g. `useProspectStore((s) => s.stableRs)`, so a
voter mutation or an unrelated field change doesn't re-render them.

## Pure functions (the testable win)

1. `nextReadingState(prev, { reading, ocrScore, now, minConf, holdMs }, voter)` →
   `{ stableRs, settling, readState, lastValidAt, hadReading }`. The voter is the one
   controlled side-effect (push/stable/candidate/reset); it's deterministic, so tests use
   the real `createVoter` and assert frame-by-frame.
2. `deriveOverlayStatus({ sourceLost, paused, readState, stableRs, matchCount, hasScanRegion, frozenScan, rawRs })` → `OverlayStatus`.
3. `deriveHealth({ sourceLost, paused, hasRsRegion, capturing, confPct })` → `{ color, label }`.

New tests: `test/prospect-reading.test.ts` (clean read → lock, hold window, expire/drop,
low-conf gate, settling on value change) and `test/prospect-status.test.ts` (every branch
of `deriveOverlayStatus` + `deriveHealth`). No DOM/Electron needed — exactly the logic that
let the overlay-visibility bug through.

## What stays in `ProspectView` (orchestrator)

- Top-level React state that isn't pipeline runtime: `activeId`, `panelTab`, `mediaRef`.
- `useSurveyCapture(mediaRef, active, params, !paused, table)` (needs mediaRef + lifecycle),
  then a small effect forwarding each tick into the store:
  `store.pushReadout(readout, performance.now())` + `store.pushScan(readout.scan, oreVocab)`.
- `store.configure(...)` effect when `params` change; `store.reset()` on unmount.
- Cheap derivations from `store.stableRs` + props: `matches` (matchWithNoise),
  `overlayCandidates`, `top`, `detail`, `systemGroups`, `previewRegions`, `activePreset`.
- The **overlay-push effect** (`sendMatches`) and the **hotkey-command effect** (pause/
  recalibrate) — read store + props; small enough to keep here (or `useOverlayPush` /
  `useHotkeyCommands` hooks if cleaner).
- Layout: header (uses `deriveHealth`) + `CapturePreview` + `ProspectResults` +
  `ProspectSettings` + `ProspectStatusBar`.

## Order of work (small, verifiable commits)

1. `npm i zustand`. Add `prospect/rsReading.ts` + `prospect/status.ts` (pure) **with unit
   tests**. ScanView imports them but keeps its effects → tests prove behavior matches.
2. Add `prospect/store.ts`; move the voting/scan/sourceLost/tickRate state into it. ScanView
   forwards ticks into the store and reads it (still one file). Verify parity.
3. Extract `ProspectResults` → `ProspectStatusBar` → `ProspectSettings` (largest last);
   each selects from the store / takes settings props. Move `NoiseBadge`/`LooseBadge`/
   `StatItem`/`LabeledSelect`/`LocationSelect` alongside consumers.
4. Rename the shell to `ProspectView`, repoint `App.tsx`, delete `components/ScanView.tsx`.
   Final typecheck/biome/build.

## Risks

- **The `readout` transition is subtle** (keyed on `readout`; reads `minConf`/`holdMs`
  deliberately; mutates voter + 3 accumulators). Extract the *pure* `nextReadingState`
  first with tests, then have the store action call it — don't hand-rewrite the logic.
- **Store is a module singleton.** Only one `ProspectView` exists, but it must `reset()` on
  unmount (back to Sources / tab switch) or stale `stableRs`/`frozenScan` leak into the next
  session. Cover with an unmount effect.
- **Zustand re-render scope:** use narrow selectors (+ `useShallow` for object slices) so
  per-tick `pushReadout` only re-renders components that read the changed field.
- **New dep on an RC branch** (zustand). Tiny + widely used; flagged.
- StrictMode double-invoke (dev): store actions are idempotent per tick; `reset()` on
  unmount/remount keeps it clean.

## Verification

- `npm run typecheck`, `npm run check` (biome), `npm test` — all green, **new pure-logic
  tests added**.
- `npm run build` green; control CSS unchanged (no markup/class changes).
- Manual `npm run dev`: lock/hold/expire, pause/recalibrate hotkeys, source-lost banner +
  reconnect, overlay push, every settings subtab, leave-and-return (store reset) — identical.

## Outcome

`ScanView` (1080) → `ProspectView` (~250) + a focused store + 3 presentational components +
2 pure, tested modules. The hardest file in the repo becomes the most readable layer, and
the scan-pipeline logic is finally unit-covered. `SurveyView` can follow the same recipe.

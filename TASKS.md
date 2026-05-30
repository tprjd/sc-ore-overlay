# TASKS.md — phased build plan

Build top to bottom. Each phase lists **tasks**, an **acceptance check** (make it objective and
runnable wherever possible), and whether **human verification** is required before moving on. Don't
start a phase until the previous one's acceptance passes. Read `CLAUDE.md` first — the locked stack,
verified domain knowledge, and the matcher spec live there.

---

## Phase 0 — Project skeleton, data, and the tested core

**Tasks**
- Scaffold the locked stack: TypeScript + Vite + React + Electron (with a Vite↔Electron plugin),
  Vitest, electron-builder. Set up `npm run dev`, `build`, `test`, `typecheck`, `crawl`, `dist`.
- Define the data types (see CLAUDE.md "Target architecture" and the matcher spec).
- Write the build-time wiki crawl script: enumerate commodities, keep mineable, fetch each detail,
  extract `locations[].resources[].signature` + `label` + `clustering` (+ methods, systems,
  per-location group probability), collapse duplicate rows (same material+signature+cluster range,
  merging locations), filter to ship-mineable for v1, and write a compact local table the renderer
  can load.
- Implement the **matcher** and **validator** (plausibility + N-frame temporal voting) as pure
  functions per the CLAUDE.md spec.
- Write Vitest specs for the matcher and validator **first**, using a small hand-built fixture that
  includes an overlapping-signature case.

**Acceptance**
- `npm test` is green and covers: clean match, overlap → two candidates, cluster-min rejection,
  cluster-max rejection, location filter, method filter (non-Ship excluded), OCR-jitter tolerance,
  no-match, and temporal-voting accept/reset.
- `npm run crawl` (against the live API, current patch) writes a table with many deposits; a sanity
  log confirms **Iron is present with signature 4270** (not 4700).
- `npm run typecheck` passes.

**Human verification:** none. (Crawl needs network — if blocked, ask the human to run it.)

> Note on pagination: the exact list-endpoint pagination is not assumed in CLAUDE.md. Inspect a live
> `GET /api/commodities` response and implement whatever it actually uses; verify the crawl
> enumerated the full mineable set (log the count).

---

## Phase 1 — Screen capture, region calibration, OCR reading

**Tasks**
- Control window: enumerate capture sources via `desktopCapturer`; let the user pick the Star
  Citizen window/screen; render a still frame.
- Region picker: user drags a rectangle over the RS number; store it as **normalized** (0..1)
  coordinates so it survives resolution changes.
- Capture loop: sample a frame every ~0.5–1s, crop to the region, preprocess
  (upscale → grayscale → threshold, optional invert), and OCR with Tesseract.js **restricted to
  digits**. Skip OCR when the cropped region is unchanged.
- Add a visible **debug view** showing the binarized crop + raw OCR text + parsed value, so
  threshold tuning is observable.

**Acceptance**
- Given a real SC scanner screenshot with a known RS value, the control window reads that exact
  number, and the temporal voter accepts it after the configured consecutive-frame quorum.

**Human verification REQUIRED.** You need real screenshots of the user's HUD at their resolution to
tune the preprocessing constants. Build the debug/tuning view, then ask the human for sample
screenshots and iterate until reads are reliable. Do not mark Phase 1 done otherwise.

---

## Phase 2 — Wire the matcher; show name + node count

**Tasks**
- Feed accepted readings into the matcher with `method: "Ship"` and the selected location context.
- Render candidates in the control window as `Ore ×N`; render all candidates on overlap.
- Build the location dropdown (System → location, plus "Anywhere") from the crawled table; confirm
  it narrows and re-weights matches.

**Acceptance**
- A known Iron ×5 reading shows `Iron ×5`. An overlapping-signature reading shows both ores. Picking
  a location where only one of the overlapping ores spawns narrows the result to that ore. (These
  are already unit-tested in Phase 0; here the **live UI** must reflect them.)

**Human verification:** none beyond eyeballing the control window.

---

## Phase 3 — Transparent in-game overlay

**Tasks**
- Create the overlay window: transparent, frameless, always-on-top, skip-taskbar, non-focusable,
  click-through by default.
- Push matches from the control window to the overlay over IPC; render `Ore ×N`, stack both on
  overlap, fade when idle.
- Implement global hotkeys: toggle overlay visibility, pause/resume OCR, re-enter calibration.
- Implement an "edit overlay" mode that temporarily makes the overlay interactive (so it can be
  dragged/repositioned), then locks it back to click-through.

**Acceptance**
- With Star Citizen in **borderless windowed**, the overlay is visible on top of the game, does not
  steal focus, passes clicks through to the game, and updates live as the user scans.

**Human verification REQUIRED.** Always-on-top + click-through over a game is OS/version sensitive.
Implement, then ask the human to confirm in-game; document any platform-specific tweaks.

---

## Phase 4 — Persistence, patches, polish

**Tasks**
- Persist settings (capture source, region preset(s), location, active patch) to Electron `userData`
  so they survive restart.
- Patch-version switcher: choose which crawled table is active; the location dropdown updates.
- Optional: a "check for data update" that pulls a newer crawled table from a URL the user controls.
- Optional enrichment: lazy live sell price (e.g. UEX/SC-Trade), cached with a TTL, **never** on the
  identification hot path.

**Acceptance**
- Restarting restores the last source/region/location. Switching patch reloads the table and the
  dropdown reflects it.

**Human verification:** none.

---

## Phase 5 — Multiple mining methods (deferred from v1)

**Tasks**
- Relax the ship-only filter in the crawl (method is already recorded per row).
- Add ROC (Vehicle) and FPS to the method selector; the matcher already takes a method parameter.
- Add per-method region presets (panel position differs across scan UIs).

**Acceptance**
- Selecting ROC mining matches vehicle-mineable deposits with correct signatures and node counts.

**Human verification:** screenshots of the other scan UIs for region presets.

---

## Phase 6 (optional) — Browser-only build

**Tasks**
- A standalone web entry using `getDisplayMedia` for capture, reusing the pure `src/core` logic.
- No overlay window; results render in the page (suitable for a second monitor).

**Acceptance**
- The web build identifies ores from a shared screen in a normal browser tab.

---

## Reminders that apply to every phase

- Phase by phase; don't skip ahead. Run the acceptance check before continuing.
- Keep the matcher/validator pure and fully tested; if you must change them, add a failing test
  first.
- Honor the guardrails in CLAUDE.md (read-only, wiki etiquette, no stack swaps).
- At the two human checkpoints, build the mechanism and then stop and ask — don't fabricate
  verification.

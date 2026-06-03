# TASKS.md — remaining build plan

Phases 0–5 are **built** (core matcher + validator, wiki crawl, screen capture + PP-OCR,
matcher wired to UI, transparent overlay + global hotkeys + edit mode, settings/patch
persistence, ore-quality detail box). They are removed from this file — see `CLAUDE.md` for
the domain knowledge and matcher spec, and git history for how each shipped.

Both v1 human-verification gates are **passed** (2026-06-03): real-HUD OCR reads digits
correctly across chip background colors, and the transparent overlay draws over the running game
(borderless windowed) without stealing focus or blocking clicks. **v1.0.0 shipped.**

What's left below: a **UI/UX** chapter to make the shipped app more legible (Part I), then the
**deferred/optional** feature work (Part II). Read `CLAUDE.md` first — locked stack, guardrails,
and matcher spec live there.

Current version: **1.0.0** — v1 done (ship mining: capture → OCR → match → live overlay,
confirmed in-game). Part I lands as 1.1.x; Part II (other mining methods) is the next minor/major.

---

# Part I — UI/UX

App is functional but the in-game overlay reads flat and the control window is a single
monolithic panel (`ScanView`, ~760 lines). This chapter makes both legible. Stays out of the
pure `src/core` matcher/validator logic; small additions to shared payload types (`bridge.ts`)
are allowed where a UI item needs data the overlay doesn't yet receive (called out per item).

## U0 — Hide Survey behind a feature flag

Survey mode isn't relevant for now. Gate it so the default UI is just Mining.

**Tasks**
- Add a feature flag (e.g. `features.survey`, default `false`) read from settings.
- Hide the Survey tab when off. (`SurveyView` only mounts on the active tab, so its capture loop
  stops with it — no separate loop teardown needed.) Keep the code; don't delete it.
- When off, drop the tab bar entirely if Mining is the only tab — no orphan single tab.
- Optional: a dev/settings toggle to flip it back on.

**Acceptance**
- Fresh launch shows no Survey tab (and no lone tab bar); Mining is the whole UI. Flag on → Survey
  returns unchanged.

---

## U1 — Overlay polish (in-game card)

Scope note: this is the **mining ore-identity** overlay (`Overlay.tsx`) — it shows ore name +
node count, not a quality number. The quality colour bands (`≥900 gold … <200 red`) already
live on the separate **scan-results** overlay (`ScanOverlay.tsx`) and act on the scanned rock's
quality; don't conflate the two. `OverlayCandidate` currently carries `name/nodes/score/noise/
loose` only — items needing more (signature) note the data add.

**Tasks**
- **Confidence indicator:** show voter state — settling (pulsing dot) vs locked (solid) — on the
  top candidate. Optional thin bar driven by `candidate.score` (already in the payload).
- **Hierarchy:** top candidate larger/brighter; secondary candidates clearly demoted (smaller, not
  just dimmed); divider on overlap.
- **Signature echo:** tiny `sig×n` under the name (trust/debug), toggleable. Derive
  `sig = (reading − (noise ?? 0)) / nodes` in the overlay, or add `signature` to
  `OverlayCandidate` in `bridge.ts` and populate it where the payload is built.
- **Motion:** per-row fade/slide on change instead of hard swap.
- **Compact one-line mode:** `Ore ×N` single line as a scale/preset option.

**Acceptance**
- Overlap shows a clear primary vs secondary; settling→locked is visible; signature echo matches
  `reading/nodes`; compact mode renders on one line. Still click-through, idle-fade intact.

---

## U2 — Control window restructure

**Tasks**
- Break `ScanView` into task-grouped sections (accordion or sub-tabs): **Source · Region ·
  Matching** (noise / cluster / params / location / patch) **· Overlay look · Hotkeys**.
- Extract reusable section/field components; pull inline styles into shared design tokens
  (color / spacing / radius).

**Acceptance**
- No single scroll wall; each group collapsible/navigable. Behavior unchanged; typecheck + tests green.

---

## U3 — Setup wizard (first run)

**Tasks**
- First-launch flow: Source → Region → Location, then drop into the normal panel. The source step
  already exists (`App` renders `SourcePicker` when no source is set) — extend it into a guided
  chain rather than rebuilding source selection.
- Skip the wizard on later launches once settings exist; reachable again from a menu.

**Acceptance**
- A fresh profile is walked through pick-source → draw-region → choose-location and lands ready to
  scan. Existing profiles skip straight to the panel.

---

## U4 — Status bar + live overlay preview

**Tasks**
- Persistent status footer in the control window: current reading, voter state (settling/locked),
  capture tick rate (~1–2 samples/s — loop runs every 0.5–1s, not fps), last match.
- In-panel live preview of the overlay card in the Overlay-look section so appearance tweaks are
  instant (no alt-tab).

**Acceptance**
- Status footer updates live while scanning; editing overlay config updates the preview in real time
  and matches the real overlay.

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

## Reminders that apply to every item

- Run the acceptance check before continuing.
- Keep the matcher/validator pure and fully tested; if you must change them, add a failing test
  first.
- Honor the guardrails in CLAUDE.md (read-only, wiki etiquette, no stack swaps).
- At the human checkpoints, build the mechanism and then stop and ask — don't fabricate
  verification.

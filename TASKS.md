# TASKS.md — remaining build plan

Phases 0–5 are **built** (core matcher + validator, wiki crawl, screen capture + PP-OCR,
matcher wired to UI, transparent overlay + global hotkeys + edit mode, settings/patch
persistence, ore-quality detail box). See `CLAUDE.md` for the domain knowledge and matcher spec,
and git history for how each shipped.

Both v1 human-verification gates passed (2026-06-03) and **v1.0.0 shipped** (ship mining: capture
→ OCR → match → live overlay, confirmed in-game). The **UI/UX** chapter then shipped as
**v1.1.0** — Survey behind a feature flag, in-game overlay polish (confidence dot, score bar,
hierarchy, signature echo, motion, compact mode), control-panel restructure into sub-tabs with
shared design tokens, a first-run setup wizard, and a status bar + live overlay preview. See git
history (commits tagged `U0`–`U4`).

What's left below: a small **footer/OCR-stats** cleanup (Part I), then the **deferred/optional**
feature work (Part II). Read `CLAUDE.md` first — locked stack, guardrails, and matcher spec live
there.

Current version: **1.1.0**. Part I lands as 1.2.x; Part II (other mining methods) is the next
minor/major.

---

# Part I — Footer OCR stats (replace signature echo)

The overlay's "signature echo" (`sig×n` under the ore name) is low-value noise — the deposit
signature isn't actionable while mining. Drop it, and surface useful OCR diagnostics in the
control-window status footer instead, so a bad read is obvious at a glance.

## F1 — Remove the signature echo

**Tasks**
- Drop `OverlayConfig.showSignature` + its default (`src/shared/bridge.ts`).
- Remove the sig rendering from `OverlayCard.tsx` — the primary block, the secondary rows, and the
  compact inline case — plus the now-unused `signatureOf` helper and the `sig` / `secSig` styles.
- Remove the "Echo signature under ore name" checkbox from the Overlay tab (`ScanView.tsx`).

**Acceptance**
- No signature line anywhere in the overlay or live preview; no `showSignature` references remain;
  typecheck + tests green.

## F2 — OCR stats in the status footer

OCR already returns per-line mean confidence (`OcrLine.score`, 0..1, in `src/control/ocr.ts`); the
capture loop just doesn't surface it. Thread it (plus timing) through and show it.

**Tasks**
- In `useSurveyCapture.ts`: time each `recognize()` call (ms) and capture the confidence of the
  line `bestReading` picked, plus the detected-line count. Add them to `RegionDebug` (e.g. `score`,
  `ms`, `lineCount`) and/or a small `readout.ocr` summary scoped to the RS region.
- Extend the footer in `ScanView.tsx` with live OCR stats for the RS region: confidence %, OCR
  latency (ms), detected-line count, and the raw detected text (truncated/ellipsized). Keep the
  existing RS / state / rate; drop "last match" if space is tight (the match is already on the
  overlay).
- Colour the confidence with the existing green/amber/red bands so a poor read stands out.

**Acceptance**
- While scanning, the footer shows live OCR confidence + latency + raw text for the RS region; the
  confidence colour tracks read quality; no per-scan wiki/network calls are added.

## F3 — OCR stats on the overlay card

Surface the same useful stats on the in-game overlay (and its live preview, since both render the
shared `OverlayCard`) — taking over the slot the signature echo used to occupy, gated by a toggle
so the overlay stays clean by default.

**Tasks**
- Add an `ocr?` field to `OverlayPayload` (`bridge.ts`): `{ score, ms, lineCount }` (+ optional raw
  `text`) for the RS region. Populate it in `ScanView`'s `sendMatches` from the F2 readout data.
- Add an `OverlayConfig.showOcrStats` toggle (reuse the Overlay-tab checkbox slot freed by F1;
  default `false`).
- In `OverlayCard.tsx`: when `showOcrStats` is on, render a small muted stats line (e.g.
  `conf 0.98 · 42ms`) under the top candidate, confidence colour-banded as in F2. Pass the OCR
  stats to the preview `OverlayCard` in `ScanView` too, so the preview matches.

**Acceptance**
- With the toggle on, the in-game overlay and the live preview both show the OCR confidence +
  latency line; off by default; still click-through, idle-fade intact, no hot-path network.

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

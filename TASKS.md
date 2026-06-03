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

## Reminders that apply to every item

- Run the acceptance check before continuing.
- Keep the matcher/validator pure and fully tested; if you must change them, add a failing test
  first.
- Honor the guardrails in CLAUDE.md (read-only, wiki etiquette, no stack swaps).
- At the human checkpoints, build the mechanism and then stop and ask — don't fabricate
  verification.

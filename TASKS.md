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

What's left below: a near-term **UX chapter** (Part I) and the **deferred/optional** feature work
(Part II). Read `CLAUDE.md` first — locked stack, guardrails, and matcher spec live there.

Current version: **1.2.0**. Part I (UX restructure) is the next chapter; Part II (other mining
methods) is the next minor/major after it.

---

# Part I — UX restructure & polish (next chapter)

The control window's sub-tabs accreted by a fuzzy mix of domain + frequency, so contents ended up
"all over the place": live **output** is buried inside the Match tab, capture setup is split across
Regions + Tuning (upscale lives in both), and the Match/Tuning boundary is unclear.

**Decision (target IA): organize tabs by pipeline stage `Capture → Match → Show`, and pull live
output out of the tabs entirely.** 5 mixed tabs → **4 clean tabs + an always-visible Results pane**:

```
ALWAYS-VISIBLE RESULTS PANE
  21,350   Iron ×5   (94%)
  + scanned rock when present
──────────────────────────────
[ Capture ][ Match ][ Overlay ][ Hotkeys ]

Capture  regions, upscale (global + per-region), interval, quorum, source reconnect
Match    patch, location, enforce-cluster, noise signatures
Overlay  live preview + appearance   (unchanged)
Hotkeys  bindings                     (unchanged)
```

Do the restructure (T1–T3) first; the calibration/robustness items below land in the new tabs.

## Tab restructure — `4 tabs + results pane`

### T1 — Results pane (out of the tabs)
**Tasks**
- Pull the candidate list **and** the frozen Scanned-rock block out of the Match tab into an
  always-visible Results pane above the sub-tab bar.
- Fold the standalone "Accepted reading" readout box into that pane: hero reading + top ore name +
  confidence; kill the reading/footer RS redundancy (reading currently shows in the readout box
  *and* the footer).
- Keep the shared `OverlayCard` for the overlay; the Results pane is the control-window-native,
  fuller view (scores, noise/loose badges, composition table) — don't force it through OverlayCard.

**Acceptance**
- Switching sub-tabs never hides the matched ore(s) or the scanned rock; reading shown once.

### T2 — Capture tab (merge Tuning + Regions)
**Tasks**
- Merge the Regions tab and the Tuning tab into one **Capture** tab: region list (draw RS + scan
  boxes), global upscale, per-region scale override, interval, quorum.
- De-dupe upscale — one global control + the per-region override in the same place (no longer split
  across two tabs).
- Add a source line here (current source + a "Reconnect / change source" affordance) so capture
  setup has one home instead of only the header `← Sources`.

**Acceptance**
- Every capture/read knob (regions, upscale, interval, quorum, source) is reachable from one tab; no
  setting appears in two tabs.

### T3 — Match tab = inputs only
**Tasks**
- Reduce Match to identification **inputs**: patch, location, enforce-cluster, noise signatures.
  (Candidates + scanned rock now live in the Results pane per T1.)

**Acceptance**
- Match tab contains only patch/location/cluster/noise; no live output renders inside it.

### T4 — Preview parity for the detail + scan boxes
**Tasks**
- The Overlay-tab live preview only covers the base `OverlayCard`; the ore-detail box (`Detail.tsx`)
  and scanned-rock box (`ScanOverlay.tsx`) have toggles but no preview, because both are
  window-coupled (own `window.sco` IPC + resize inside the component).
- Extract each into a pure presentational card mirroring `OverlayCard`: `DetailCard` (props: detail,
  config) + thin window wrapper, and `ScanCard` (props: scan, config) + wrapper.
- Stack all three cards in the Overlay-tab preview, honoring `showDetail` / `showScan`, fed by the
  `detail` memo + `frozenScan` already in ScanView.

**Acceptance**
- Toggling "ore detail box" / "scanned-rock box" reflects live in the preview, matching what the
  windows render.

## A — Calibration & confidence

The hardest user task is getting the RS box right; today the only feedback is the footer.

### A1 — Per-region live calibration card
**Tasks**
- In the Capture tab's region list, show per region: the cropped thumbnail + last OCR text +
  confidence + a green/amber/red verdict (reuse `readout.regions` debug already passed to
  `RegionList`).

**Acceptance**
- A user can position the RS box correctly from the calibration card alone, without watching the
  status footer.

### A2 — Setup-wizard confirm-read gate
**Tasks**
- In the wizard's region step, show the live read of the box being drawn and a "looks good?" gate
  before advancing, so a bad crop is caught at setup time.

**Acceptance**
- The wizard won't advance past the region step until a plausible reading is shown (or the user
  explicitly overrides).

### A3 — Header health pill
**Tasks**
- Add a single rollup indicator in the header: source ✓ · RS region ✓ · getting reads ✓ · conf%.

**Acceptance**
- One glance tells the user whether the pipeline is healthy; the pill turns amber/red when a stage
  is missing or low-confidence.

## C — Overlay presets & reset

The Overlay tab is ~11 controls — sprawl.

### C1 — Appearance presets
**Tasks**
- Add Minimal / Standard / Detailed presets that set scale + which boxes/stats show in one click;
  individual controls remain for fine-tuning.

### C2 — Reset to defaults
**Tasks**
- A "Reset overlay to defaults" button (restores `DEFAULT_OVERLAY_CONFIG`) so experimenting is safe.

### C3 (optional) — Change flash
**Tasks**
- A brief highlight when the displayed ore/count changes (shipped).
- Ore color-coding by category was **dropped**: the signature table carries no category/tier field,
  so it would mean hardcoding a game classification that drifts per patch — not worth the maintenance
  for a cosmetic tint. Revisit only if a category source lands in the crawl.

**Acceptance (C)**
- A preset reconfigures the overlay in one click; reset restores defaults; both reflect live in the
  preview.

### C4 — Sortable scanned-rock card
**Tasks**
- Let the user sort the scanned-rock composition by SCU / quality / percent instead of the current
  fixed (SCU desc, inert last) order.
- The live overlay window is click-through (`setIgnoreMouseEvents`), so header clicks can't fire
  there during play. Drive the sort from a **persisted** `scanSort` field on `OverlayConfig`
  (default `'scu'`) that both the preview and the overlay obey.
- Make `ScanCard` take an optional `onSortChange?`: when set, column headers become clickable and
  update `overlayConfig.scanSort` (persists + re-sorts everywhere). Active column shows a direction
  arrow; inert rows stay pinned last.
- Wire `onSortChange` in: the control-window **preview** (always interactive) and the live overlay
  window **only while editing** — `setEditMode` already flips `setIgnoreMouseEvents` off, so the
  overlay takes clicks in edit mode. The card is a `WebkitAppRegion: 'drag'` region then, so mark the
  header cells `WebkitAppRegion: 'no-drag'` (like the resize grip) so a header click sorts instead of
  dragging the window. During normal play the overlay stays click-through and the headers are inert
  (sort still applies from the persisted config).
- Optional: apply the same pattern to `DetailCard` (quality / % columns).

**Acceptance**
- Clicking a scanned-rock column header in the preview (or on the overlay while in edit mode)
  re-sorts it and the live overlay box to match, and the choice survives a restart.

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

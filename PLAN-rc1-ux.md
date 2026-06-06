# Plan — RC1 UX tweaks

> **STATUS: all 6 implemented (2026-06-06).** Overlay-without-source bug + items 1–6
> done. Green: `npm run typecheck`, `biome check` (0 errors), 148 tests, `vite build`.

Six requested changes. Each: current state → proposed change → files → risk/decision.
Item 2 needs a human decision (it touches a CLAUDE.md guardrail) — see ⚠️.

Already shipped (separate, related fix): the overlay no longer shows its launch
placeholder before a source is picked — added an `inactive` `OverlayStatus`, the
control window pushes it whenever the Mining view isn't live, and the overlay
hides on it (`bridge.ts`, `status.ts`, `Overlay.tsx`, `App.tsx`). Item 4 below
builds on that.

---

## 1. Default "Enforce cluster-size range" to OFF

**Current:** `useAppSettings.ts:36` — `useState<boolean>(true)`. Persisted value
overrides on load (`:77`). Toggle UI at `ProspectSettings.tsx:175`.

**Change:** default `false`. Persisted setting still wins for existing users.

**Files:** `src/control/settings/useAppSettings.ts` (one line).

**Risk:** trivial. Loosens matching by default (more candidates, fewer rejects) —
intended, since stale tables make valid out-of-range counts get dropped.

---

## 2. Runtime crawl — DECIDED (runtime crawl, bundled = fallback)

**Decision (David, 2026-06-06):** Patch-to-patch signature changes are small and
should NOT require a new app build. So: crawl the wiki at runtime. Bundled
`src/data/tables/*.json` is **fallback only** (offline / first-run-before-crawl).
Crawl on first startup; on every later startup check `/game-versions` and refresh
if the patch is newer; plus a manual "Refresh ore data" button. ⚠️ This **amends
CLAUDE.md guardrail #2** ("build-time crawl only") — add a sanctioned-deviation
note (see task 2.6) mirroring the OCR ones.

**Current:** build-time only (`scripts/crawl-wiki.ts`), tables bundled under
`src/data/tables/*.json` (only `4.8.0.json`), loaded in the renderer via
`import.meta.glob` (`App.tsx:25`). Crawler auto-detects patch from
`GET /api/game-versions` (`crawl-wiki.ts:233`, `is_default`).

**Behavior:**
- **First startup, online:** no cached table → crawl → save to `userData/tables/<patch>.json` → use it.
- **First startup, offline:** crawl fails → use newest bundled table; retry next launch / on button.
- **Every later startup:** call `/game-versions` (one-shot, UA, timeout, errors swallowed). If live patch ≠ cached patch → auto-crawl + refresh in the background, non-blocking, with a small banner/progress. On failure keep the existing table.
- **Manual button** ("Refresh ore data") in the Mining panel → force re-crawl of the current patch now, with progress + result toast.
- **Never blocks launch.** App always comes up on whatever table resolves first (cached → bundled). Crawl is async, off the hot path.

**Etiquette (carry over from the script):** throttle between detail fetches, set
the existing User-Agent, cache raw API responses under `userData`, one crawl per
startup/button press — never per scan.

**Implementation tasks:**
- **2.1 Extract crawl core.** Pull the fetch-list → filter-mineable → fetch-detail
  → derive-table logic out of `scripts/crawl-wiki.ts` into a reusable module,
  parameterized by a `fetchJson` fn + cache dir + `onProgress`. CLI keeps writing
  to `src/data/tables`; the electron path injects `net.fetch` and writes to
  `userData`. Keep `deriveTable()` pure where possible.
  - Files: `scripts/crawl-wiki.ts` (slim to a CLI wrapper), new shared module
    (e.g. `electron/crawl/` — main-process, may use node + `net`; do NOT put node
    code in `src/core`).
- **2.2 Main-process table store.** `electron/tables.ts`: resolve active table
  (userData `<patch>.json` if present else newest bundled — bundled read from the
  packaged app path / asar), `crawlAndSave(patch?)`, `checkForNewPatch()` →
  `{ current, latest, hasUpdate }`. Run first-run crawl + startup check here.
- **2.3 Bridge plumbing.** `bridge.ts` + `preload.ts` + `ipc.ts`: `getTables()`
  (returns resolved tables), `refreshTables()` (force crawl), `onCrawlProgress`,
  `checkPatch()`.
- **2.4 Renderer load change.** `App.tsx loadTables` → async via the bridge
  instead of `import.meta.glob`. Bundled glob stays only as the fallback the main
  process reads. Add a crawl-in-progress / refreshed banner (reuse update-banner
  style) and wire the "Refresh ore data" button (ties to item 3's patch text).
- **2.5 Risks to handle:** schema drift (wiki shape changes) → validate + fall
  back; partial crawl failure → keep prior table, don't overwrite with a partial;
  asar read path for bundled fallback in packaged builds; first-run offline UX.
- **2.6 CLAUDE.md amendment.** Add a sanctioned-deviation note (dated, "with the
  human's explicit approval") under guardrails / the locked-stack notes: runtime
  crawl now allowed; bundled table retained as fallback; build-time crawl script
  retained for shipping a default; etiquette (throttle/UA/cache/off-hot-path)
  still binding; never read game memory etc. unchanged.

**Risk:** high (largest item). Build last; gate the rest on it being optional at
runtime so the app still works offline.

---

## 3. Patch shown as text, not a selector

**Current:** `ProspectSettings.tsx:164` — `LabeledSelect` over `patches`. Only one
table is bundled, so it's a one-option dropdown.

**Change:** replace the select with a static label (e.g. "Ore data: 4.8.0"). Keep
`activePatch` as the source of truth; drop `onPatchChange`/`patches` plumbing if
nothing else needs them (verify `App.tsx` wiring). If Option 2B later adds a
downloaded table, this can show "4.8.0 (bundled)" / "4.9.0 (downloaded)".

**Files:** `ProspectSettings.tsx` (swap component); prune now-unused props down
the chain (`ProspectView.tsx` → `App.tsx`) — check before deleting.

**Risk:** low. Mind the unused-prop cleanup so TS/Biome stay clean.

---

## 4. Remove or rename the "scanning…" placeholder

**Current:** toggle `showPlaceholder`, labelled *"Show "scanning" placeholder"*
(`ProspectSettings.tsx:459`). Text comes from `placeholderText()`
(`OverlayCard.tsx:72`) and is actually multi-state: `scanning…`, `low signal`,
`no RS`, `no scan panel`, `locking…`. After the inactive-status fix it only shows
during **active** capture, so it's a live status line, not a generic "scanning".

**Change (recommended):** rename, don't remove — it's genuinely useful now.
- Toggle label → **"Show status when no match"** (or "Show live status line").
- Hint → "Shows why the overlay is empty while capturing (no RS, no scan panel,
  low signal, locking…)."
- Optionally tidy `placeholderText()` wording.
- Update preset hint copy (`presets.ts:32`).

**Alt:** if the user wants it gone, remove the `showPlaceholder` config field +
toggle + the placeholder branch in `OverlayCard` + preset references. Larger
blast radius (`bridge.ts`, presets, both preview and real card).

**Files:** `ProspectSettings.tsx`, `OverlayCard.tsx`, `components/presets.ts`
(+ `bridge.ts` only if removing the field).

**Decision needed:** rename (recommended) or remove?

---

## 5. Hotkeys as part of initial setup

**Current:** wizard flow `welcome → source → rs → scan → options → done`
(`SetupWizard.tsx:71-72`); `STEPPER_INDEX` at `:80`. Hotkeys are configured only
in the Mining panel today; settings/registration live in
`useAppSettings.ts` (`hotkeys`, `setHotkeys`, `hotkeyStatus`). `SetupResult`
(`:53`) carries regions/location/overlayPreset — no hotkeys yet.

**Change:** add a `hotkeys` step (after `options`, before `done`) reusing the
existing hotkey-editor component from `ProspectSettings`/its children (extract a
shared `HotkeyEditor` if it's currently inline). Wire through:
- `Step` union + `FLOW` + `STEPPER` + `STEPPER_INDEX`.
- `SetupResult` gains `hotkeys?: HotkeyMap | null`.
- `SetupWizardProps` gets current `hotkeys` + an `onHotkeysChange` (so it can live-
  register and show conflict status during setup), or returns them in the result
  for `App.completeSetup` to apply.
- `App.tsx completeSetup` applies hotkeys (calls `s.setHotkeys`).

**Files:** `SetupWizard.tsx`, possibly extract `components/HotkeyEditor.tsx` from
the prospect settings, `App.tsx`, maybe `ProspectSettings.tsx` (to reuse the
extracted editor).

**Risk:** medium. Hotkey registration is async with conflict feedback; reuse the
existing path rather than duplicating. Keep the step skippable (defaults exist).

---

## 6. Overlay live preview — remove or rethink

**Current:** `ProspectSettings.tsx:298-330` renders a live `OverlayCard` (+ Detail
+ Scan) fed by store runtime values (`stableRs`, `settling`, `frozenScan`, `ocr`).
It duplicates what's already on screen in the real overlay and pulls per-tick
runtime state into the settings panel (`:136` comment).

**Options:**
- **A (recommended): remove the live preview.** The real overlay is on screen and
  now correctly gated; a duplicate live copy adds re-render churn and store
  coupling. Drop the "Live preview" block; keep the style toggles. Style changes
  are visible immediately on the actual overlay via the existing config IPC echo.
- **B: static style preview.** Replace live values with a fixed sample payload
  (e.g. "Iron ×5") so the panel shows *style* without subscribing to runtime
  state — decouples the panel from the store, still useful when the overlay is
  off-screen / on another monitor.
- **C: keep but make it collapsible/opt-in.**

Recommend A; fall back to B if the user wants an at-a-glance style check.

**Files:** `ProspectSettings.tsx` (remove block + the store-runtime subscriptions
it alone uses — verify `stableRs/settling/frozenScan/ocr/detail` aren't needed
elsewhere in the panel before removing the props/wiring through `ProspectView`).

**Decision needed:** A, B, or C?

---

## Decisions — all locked (David, 2026-06-06)
1. **Item 1:** default OFF. ✓
2. **Item 2:** runtime crawl, bundled = fallback only (first-run crawl + per-startup
   check + manual refresh). Amends guardrail #2 — sanctioned-deviation note. ✓
3. **Item 3:** patch as static text. ✓
4. **Item 4:** rename placeholder toggle + clarify (keep feature). ✓
5. **Item 5:** add hotkeys step to the setup wizard. ✓
6. **Item 6:** remove the live preview. ✓

## Suggested order
1 (trivial) → 3 (text) → 4 (rename) → 6 (remove preview) → 5 (wizard hotkeys) →
2 (runtime crawl, largest — build last; item 3's patch text plugs into 2.4).

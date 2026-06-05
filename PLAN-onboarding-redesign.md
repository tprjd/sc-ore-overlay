# Plan — Onboarding & Setup Redesign

Status: **implemented 2026-06-06** · Branch: `release/1.0.0-rc.1` · Author: David + Claude

> **Implemented.** Full migration (per the final decision): the entire control window now uses
> Tailwind v4 + the `src/control/ui/` primitives; `tokens.ts` was deleted. Onboarding (Welcome →
> Source → RS → Scan(opt) → Options(opt) → Done), redesigned SourcePicker/SourceGrid, and the
> About reset controls (Re-run setup + Reset everything via `sco:reset-settings`) are all in.
> Overlay/detail/scan cards stay runtime-inline (`OverlayConfig`-driven) by necessity. Build,
> `biome ci`, typecheck, and all 122 tests pass. Notes: `@tailwindcss/vite` is loaded via dynamic
> import in an async `vite.config.ts` (ESM-only plugin, CJS config); `theme.css` is Biome-excluded.

## Goal

Make the first-run experience real: a proper opening/welcome screen, a richer but
fully-skippable setup wizard, a redesigned capture-source picker, and a way to
reset setup (re-run wizard) or factory-reset the whole app. Introduce a small
component library so these screens have hover/focus/transition polish that inline
styles can't give.

## Decisions (from Q&A)

| Topic | Decision |
|---|---|
| Styling | **Component library**: Tailwind v4 + hand-rolled shadcn-style primitives (Radix under Dialog/Select/Tabs/Tooltip) + `cva`/`clsx`/`tailwind-merge` + `lucide-react` icons. |
| Scope of styling | **Full migration (one system).** Every control-window component is rewritten on Tailwind + primitives; the inline-`S`/`tokens.ts` styling in the control UI is removed. **Exception:** the overlay/detail/scan cards render in the transparent overlay windows and their appearance is driven by `OverlayConfig` at *runtime* (bgColor/opacity/padding/gap/font), so they stay dynamic-inline — that's a runtime concern, not a parallel design system. Tailwind theme is mapped to the current `C` hexes so the look is preserved. |
| Reset | **Two buttons in About**: "Re-run setup" (clears `setupComplete` → wizard reopens, keeps regions/source) and "Reset everything" (confirm → wipe `settings.json` → relaunch to clean first-run). |
| Wizard steps | Welcome+borderless · Source (integrated) · RS region+test · **Scan Result region (optional)** · Location + overlay preset (optional). Every non-essential step individually skippable; whole wizard skippable from the header at any point. |

## Scope / non-goals

- **In scope (full migration):** all control-window components — `App`,
  `SourcePicker`, `SetupWizard`, `ScanView`, `SurveyView`, `RegionList`,
  `controls.tsx`, `AboutPanel`, `CapturePreview`, `ScanResults`, `SurveyMap` —
  rewritten on Tailwind + primitives. `tokens.ts` is reduced to the shared hex
  constants still needed by the runtime-inline overlay cards (or removed if none).
- **Out of scope:** OCR, matcher, capture loop, core logic — untouched.
- **Overlay cards stay dynamic-inline** (runtime `OverlayConfig`); Tailwind/global
  CSS loads **only** in the control window entry, never in the transparent
  overlay/detail/scan windows (would alter their transparency/appearance).

## Dependencies to add (network required — `npm install`)

Runtime:
- `tailwindcss@^4`, `@tailwindcss/vite@^4`
- `class-variance-authority`, `clsx`, `tailwind-merge`
- `@radix-ui/react-dialog`, `@radix-ui/react-select`, `@radix-ui/react-tabs`, `@radix-ui/react-tooltip`, `@radix-ui/react-slot`
- `lucide-react`

If `npm install` is blocked, stop and ask the human to run it (per CLAUDE.md).

## Design system setup

1. `src/control/ui/theme.css` — `@import "tailwindcss";` + a `@theme` block that
   maps CSS vars to the existing palette (`tokens.ts` `C`): `--color-bg`,
   `--color-surface`, `--color-border`, `--color-accent`, etc. Single source of
   truth shared with inline styles (keep `tokens.ts`, derive both from the same hexes).
2. `vite.config.ts` — add `@tailwindcss/vite` plugin.
3. `src/control/main.tsx` — `import './ui/theme.css'` (control entry only).
4. `src/control/ui/cn.ts` — `cn()` = `twMerge(clsx(...))`.
5. Primitives in `src/control/ui/`:
   - `Button.tsx` (cva variants: primary/secondary/ghost/link/danger; sizes sm/md).
   - `Card.tsx`, `Badge.tsx`, `Stepper.tsx` (numbered, done/active/idle states).
   - `Select.tsx` (Radix Select, styled — replaces native `<select>` on new screens).
   - `Dialog.tsx` (Radix Dialog — confirm dialogs, e.g. factory reset).
   - `Tooltip.tsx` (Radix Tooltip).
   - `index.ts` barrel.
6. Biome: className strings are fine; run `npm run check:fix` after.

## Onboarding flow (new state machine in `App.tsx`)

First run (`!setupComplete && no regions`) enters the wizard at **Welcome**.
The wizard owns source + region steps, so the bare "SourcePicker shows first"
path is replaced. Non-first-run with no source still shows the standalone picker
(source doesn't persist across launches; auto-reconnect unchanged).

`SetupWizard` step order:
1. **Welcome** — what the app does, the borderless-windowed requirement (callout),
   big "Get started" + always-visible "Skip setup". Informational, nothing required.
2. **Source** — embeds the redesigned `SourcePicker` content. "Next" disabled until
   a source is picked. (This is the only practically-required pick; still skippable
   via header "Skip setup", which drops to the standalone picker.)
3. **RS region + test read** — current core step (draw box, Test read, "Use anyway").
   Skippable with a warning; the one genuinely-needed field.
4. **Scan Result region (optional)** — NEW. Same draw UI, role `scanResult`,
   clearly labelled optional with a "Skip this step" action.
5. **Location + overlay preset (optional)** — location dropdown (Anywhere default)
   + Minimal/Standard/Detailed preset chips. Skippable.
6. **Done** — summary of what was set, "Finish" → main panel.

Header (all steps): `← Sources` (or `← Back`), step title, source badge, and a
persistent **Skip setup** link. A horizontal `Stepper` shows progress; optional
steps marked.

`completeSetup` extended to accept the optional scan region + chosen overlay
preset (apply via `onOverlayConfigChange`) in addition to RS region + location.

## Source picker redesign

Rebuild `SourcePicker` with primitives:
- Cleaner header, larger thumbnail cards with hover lift + selected ring.
- A text filter to find a window/screen by name when the list is long.
- `screen` vs `window` grouping or a type filter.
- Tidied toolbar: Refresh + "Load image…/video…" as secondary buttons with icons.
- Better empty/error/loading states (skeleton while enumerating).
- Reused both standalone and as the wizard's Source step (extract the list/grid
  into a `SourceGrid` used by both; `SourcePicker` = standalone shell around it).

## Reset plumbing

Main process (`electron/main.ts`):
- `sco:reset-settings` (ipcMain.on): delete `settings.json` (and optionally
  `survey-log.json`? No — keep logs; only wipe settings), then
  `app.relaunch(); app.exit(0)`.
- Keep `setupComplete` clearing client-side (just `setSettings({ setupComplete:false })`
  + `setShowWizard(true)`), no IPC needed for re-run.

Bridge (`src/shared/bridge.ts` + `electron/preload.ts`):
- Add `resetSettings(): void` to `ScoBridge` + preload `ipcRenderer.send`.

About panel (`AboutPanel.tsx`):
- New "Setup" section: "Re-run setup" (needs an `onReRunSetup` prop threaded
  from App → ScanView → AboutPanel) and "Reset everything" (opens a `Dialog`
  confirm → `window.sco.resetSettings()`).

## Files

Add:
- `src/control/ui/theme.css`, `cn.ts`, `Button.tsx`, `Card.tsx`, `Badge.tsx`,
  `Stepper.tsx`, `Select.tsx`, `Dialog.tsx`, `Tooltip.tsx`, `index.ts`
- `src/control/components/WelcomeStep.tsx` (or inline in wizard)
- `src/control/components/SourceGrid.tsx` (extracted)

Change:
- `package.json` (deps), `vite.config.ts` (plugin), `src/control/main.tsx` (css import)
- `src/control/App.tsx` (flow/state, reset wiring, pass overlay-preset apply)
- `src/control/components/SetupWizard.tsx` (multi-step rebuild)
- `src/control/components/SourcePicker.tsx` (redesign + extract grid)
- `src/control/components/AboutPanel.tsx` (Setup/reset section)
- `src/control/components/ScanView.tsx` (thread `onReRunSetup`; minimally restyle
  header buttons via `Button` for consistency — optional)
- `electron/main.ts`, `electron/preload.ts`, `src/shared/bridge.ts` (reset IPC)

## Risks

- **Dep weight / RC timing**: several new deps right before 1.0. Mitigated by
  scoping the rewrite to onboarding screens and theme-matching the rest.
- **Visual mismatch** between Tailwind screens and inline-token screens: mitigated
  by mapping the Tailwind theme to the same hexes.
- **Overlay windows must stay untouched**: enforced by importing CSS in the control
  entry only; verify overlay/detail/scan still render identically.
- **Tailwind v4 + Vite multi-entry**: plugin scans all sources; ensure the overlay
  HTML entries don't pull the control CSS (they import their own `*Main.tsx`).

## Verification

- `npm run typecheck`, `npm run check` (Biome), `npm test` all green.
- `npm run dev`: first run shows Welcome → can skip entirely; can walk all steps;
  optional steps skip cleanly; Done lands on main panel.
- Re-run setup from About reopens the wizard with existing values.
- Reset everything → confirm → app relaunches to first-run Welcome.
- Overlay/detail/scan windows visually unchanged.

## Commits (phased)

1. chore: add Tailwind + UI primitive deps, theme, `cn`, base primitives.
2. feat(onboarding): redesign SourcePicker + extract SourceGrid.
3. feat(onboarding): multi-step skippable SetupWizard (welcome/source/RS/scan/loc).
4. feat(settings): reset-settings IPC + About reset/re-run buttons.
5. chore: wire App flow + first-run detection + verification fixes.

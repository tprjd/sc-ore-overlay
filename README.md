# SC Ore Overlay

A non-obstructive desktop overlay for **Star Citizen ship mining**. It captures a
shared screen, reads the **Radar Signature (RS)** number off the mining-scanner HUD
from a user-defined region, identifies which ore the reading corresponds to, and
shows the ore name + node count on a transparent, always-on-top, click-through
overlay while you play.

> **v1 scope: ship mining only.** ROC/FPS mining is deferred.

## How identification works

The scanner shows a **total** RS that equals one deposit's per-deposit signature
times the number of rocks (nodes) in the cluster:

```
total_RS = deposit.signature × node_count
```

So a reading of `21350` is `4270 × 5` → **Iron, 5 nodes**. Identification is
*constrained division*: a deposit qualifies only when its signature divides the
reading cleanly **and** the node count falls inside that deposit's valid cluster
range. Overlapping signatures can yield more than one candidate — the overlay
shows all of them.

## Stack

TypeScript (strict) · Electron · React · Vite · **PP-OCR** (PaddleOCR detection +
recognition; default native DirectML backend, WASM in-renderer fallback) · Vitest ·
electron-builder. See `CLAUDE.md` for the locked stack and domain notes, and
`NOTES.md` for the OCR knobs, roadmap, and known issues.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite + Electron in development. |
| `npm run build` | Build the renderer + Electron main/preload. |
| `npm run setup:models` | Copy PP-OCR models from `@gutenye/ocr-models` into `public/models` (auto-run by dev/build). |
| `npm test` | Run the Vitest suite (matcher, validator, table, image, parse). |
| `npm run typecheck` | Type-check the browser and Node projects. |
| `npm run crawl` | Crawl the SC Wiki API → bundled fallback `src/data/tables/<patch>.json`. |
| `npm run dist` | Package a Windows build with electron-builder. |

### The signature table (runtime crawl + bundled fallback)

The app crawls the [Star Citizen Wiki API](https://api.star-citizen.wiki) **at
runtime** into your `userData` folder: on first launch, when it detects a game
patch newer than what you have, or via the **Refresh ore data** button (Mining →
Match). So ore data isn't tied to an app build. The table committed under
`src/data/tables/<patch>.json` is the **offline / first-run fallback**; the active
patch is always the newest available (shown as text in the Match panel — no
dropdown). See the runtime-crawl note in `CLAUDE.md`.

`npm run crawl` (re)generates that bundled fallback at build time:

```bash
npm run crawl                 # ship-mineable only (v1), auto-detect patch
npm run crawl -- --patch=4.2  # tag the output with a patch label
npm run crawl -- --refresh    # ignore the on-disk cache and re-fetch
npm run crawl -- --all-methods # keep every mining method (deferred: ROC/FPS)
```

Both crawls are throttled, send a descriptive User-Agent, and are **never** called
on the per-scan hot path.

### Reading the number (OCR)

The RS number is read with **PP-OCR** (PaddleOCR detection + recognition). You draw
a *rough* box over the number; text detection localizes the digits inside it
(ignoring the pin icon / padding) and reads the raw HUD text on any background — no
threshold tuning. Models ship in the `@gutenye/ocr-models` dependency and are copied
into `public/models` at dev/build time (`setup:models`).

By default OCR runs on a **native DirectML backend** (GPU OCR on any DX12 GPU, in an
Electron utility process), auto-falling back to **WASM** (CPU, in-renderer) if that
can't start. A `WebGPU` backend exists but isn't recommended (it contends with the
overlay for the GPU). Switch backends in the **Capture** tab; the active one shows in
the status footer. See `NOTES.md` (OCR pipeline) for the why + tuning knobs.

## Requirement: run Star Citizen in borderless windowed mode

Click-through overlays do **not** draw over exclusive fullscreen. Set Star
Citizen to **Borderless** (or **Windowed**) in graphics settings so the overlay
is visible on top of the game.

## Overlay & hotkeys

The app opens two windows: the **control** window (capture / calibrate / match)
and a transparent, always-on-top, click-through **overlay** that shows `Ore ×N`
over the game and fades when idle. Global hotkeys (rebindable in the control
window's **Hotkeys** panel — bindings persist):

| Hotkey | Action |
| --- | --- |
| `Alt+Shift+O` | Toggle overlay visibility |
| `Alt+Shift+P` | Pause / resume OCR |
| `Alt+Shift+R` | Re-enter calibration (redraw the RS region) |
| `Alt+Shift+E` | Toggle "edit overlay" mode — drag the overlay to reposition, then press again to lock it back to click-through |

The overlay passes all clicks through to the game except in edit mode, and only
draws over **borderless/windowed** games (see above). From the control window's
**Overlay** panel, set the fade-out delay (or **Never**), size (compact / normal
/ large), font, background color, opacity, padding, and line gap. In edit mode (`Alt+Shift+E`) drag
to move and drag the corner grip to resize. Position, size, and settings persist.
Enable **Show ore detail box** for a second window showing the matched ore's
per-location quality breakdown — possible qualities, spread, and composition.

## First run & settings

A skippable setup wizard walks first-run through: capture source → RS region (with a
test read) → optional SCAN RESULTS region → capture speed (Fast / Normal / Slow) →
location + overlay style → hotkeys. Re-run it any time from **Setup** in the control
window; "Reset everything" (About) wipes settings back to a clean first run.

Capture source, RS region, location, OCR tuning, overlay appearance, and hotkeys
persist to Electron `userData` and restore on the next launch — the last capture
source auto-reconnects if it's still available. Ore data is always the newest crawled
or bundled patch (no manual selection).

## Installing (Windows, unsigned)

The installer isn't code-signed yet, so Windows SmartScreen shows an "unknown
publisher" warning on first launch. Click **More info → Run anyway** to proceed.

## Guardrails

Read-only by design: screen capture + public-data lookup only. The app never
reads game memory, injects into the game, hooks input, or automates gameplay.

## License

[MIT](LICENSE). Use, modify, and redistribute freely; keep the copyright notice.

This license covers the app's own source only. Star Citizen and its assets are
trademarks of Cloud Imperium Games — this is an unofficial, fan-made tool, not
affiliated with or endorsed by CIG. Signature data is derived at build time from
the [Star Citizen Wiki](https://starcitizen.tools) and remains under its own terms.

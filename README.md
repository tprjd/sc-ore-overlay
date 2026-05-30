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
recognition via `@gutenye/ocr-browser` on ONNX Runtime Web) · Vitest ·
electron-builder. See `CLAUDE.md` for the locked stack and domain notes, and
`TASKS.md` for the phased build plan.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite + Electron in development. |
| `npm run build` | Build the renderer + Electron main/preload. |
| `npm run setup:models` | Copy PP-OCR models from `@gutenye/ocr-models` into `public/models` (auto-run by dev/build). |
| `npm test` | Run the Vitest suite (matcher, validator, table, image, parse). |
| `npm run typecheck` | Type-check the browser and Node projects. |
| `npm run crawl` | Build-time crawl of the SC Wiki API → `src/data/signatures.json`. |
| `npm run dist` | Package a Windows build with electron-builder. |

### Crawling the signature table

The signature table is generated at build time from the
[Star Citizen Wiki API](https://api.star-citizen.wiki) and committed to
`src/data/tables/<patch>.json` (one file per patch). Re-crawl **per game
patch** — signatures and clustering change between patches — then switch the
active patch from the **Patch** dropdown in the control window.

```bash
npm run crawl                 # ship-mineable only (v1)
npm run crawl -- --patch=4.2  # tag the output with a patch label
npm run crawl -- --refresh    # ignore the on-disk cache and re-fetch
npm run crawl -- --all-methods # keep every mining method (Phase 5)
```

The crawl is throttled, cached under `.cache/`, and sends a descriptive
User-Agent. It is **never** called on the per-scan hot path.

### Reading the number (OCR)

The RS number is read with **PP-OCR** (PaddleOCR detection + recognition) on ONNX
Runtime Web, in the renderer. You draw a *rough* box over the number; text
detection localizes the digits inside it (ignoring the pin icon / padding) and
reads the raw HUD text on any background — no threshold tuning. Models ship in
the `@gutenye/ocr-models` dependency and are copied into `public/models` at
dev/build time (`setup:models`); the ONNX Runtime WASM is fetched from a CDN in
dev (bundled for offline use when packaging).

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
**Overlay** panel, set the fade-out delay (or **Never**) and the size (compact /
normal / large); resize the overlay by dragging its edges in edit mode. Position,
size, and these settings persist.

## Settings

Capture source, RS region, location, OCR tuning, and the active patch persist to
Electron `userData` and are restored on the next launch — the last capture
source auto-reconnects if it's still available.

## Guardrails

Read-only by design: screen capture + public-data lookup only. The app never
reads game memory, injects into the game, hooks input, or automates gameplay.

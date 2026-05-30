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

TypeScript (strict) · Electron · React · Vite · Tesseract.js (digit OCR) ·
Vitest · electron-builder. See `CLAUDE.md` for the locked stack and domain notes,
and `TASKS.md` for the phased build plan.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite + Electron in development. |
| `npm run build` | Build the renderer + Electron main/preload. |
| `npm test` | Run the Vitest suite (matcher, validator, table). |
| `npm run typecheck` | Type-check the browser and Node projects. |
| `npm run crawl` | Build-time crawl of the SC Wiki API → `src/data/signatures.json`. |
| `npm run dist` | Package a Windows build with electron-builder. |

### Crawling the signature table

The signature table is generated at build time from the
[Star Citizen Wiki API](https://api.star-citizen.wiki) and committed to
`src/data/signatures.json`. Re-crawl **per game patch** — signatures and
clustering change between patches.

```bash
npm run crawl                 # ship-mineable only (v1)
npm run crawl -- --patch=4.2  # tag the output with a patch label
npm run crawl -- --refresh    # ignore the on-disk cache and re-fetch
npm run crawl -- --all-methods # keep every mining method (Phase 5)
```

The crawl is throttled, cached under `.cache/`, and sends a descriptive
User-Agent. It is **never** called on the per-scan hot path.

## Requirement: run Star Citizen in borderless windowed mode

Click-through overlays do **not** draw over exclusive fullscreen. Set Star
Citizen to **Borderless** (or **Windowed**) in graphics settings so the overlay
is visible on top of the game.

## Guardrails

Read-only by design: screen capture + public-data lookup only. The app never
reads game memory, injects into the game, hooks input, or automates gameplay.

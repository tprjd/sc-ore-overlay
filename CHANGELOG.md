# Changelog

All notable changes to **SC Ore Overlay** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(0.x while pre-1.0).

## [1.0.0-rc.2] — 2026-06-06

Build/release-process only — no app-behavior changes from rc.1.

### Changed

- **Installer ~31% smaller (~225 MiB → ~154 MiB).** `onnxruntime-node` ships every
  platform's prebuilt binaries in one tarball, so the Windows-x64 build was bundling
  ~470 MB of unused native libraries (including a 329 MB Linux CUDA `.so`) plus 142 MB
  of `onnxruntime-web` WASM that loads from the jsDelivr CDN at runtime and is never read
  from disk. The build now bundles only the `win32/x64` runtime it actually uses.

### Fixed

- **Release build no longer fails at publish.** On a CI tag build, electron-builder
  auto-detected the tag and tried to publish to GitHub itself, dying with
  `GitHub Personal Access Token is not set`. The build step now runs
  `electron-builder --publish never`; the explicit workflow step attaches the installer.
  RELEASING.md corrected to match.

## [1.0.0-rc.1] — 2026-06-05

First release candidate for 1.0. Everything below landed on `main` after v0.3.0;
both v1 human-verification gates (OCR on the real HUD, overlay-over-game) plus the
R4/R6 in-game checkpoints are confirmed.

### Added

- **Native DirectML OCR sidecar (R4/R5).** OCR can run on `onnxruntime-node` +
  DirectML in an Electron `utilityProcess` with its own D3D12 device — vendor-agnostic
  GPU OCR (any DX12 GPU) with no overlay/compositor contention. It is now the launch
  **default**, selectable in the Capture tab, with the active engine shown in the status
  footer. Auto-falls back to the in-renderer WASM worker when the native host can't start.
- **Overlay presence & staleness (R6).** Reads only show while fresh: a confidence gate
  drops garbage frames, `holdMs` holds the last ore then clears it when the RS chip leaves,
  the scan box appears only when a real SCAN RESULTS panel is detected, and the overlay
  vanishes entirely on capture-source loss. The control window names *why* nothing shows
  (`low conf` / `held` / `expired` / `no scan panel` / `source lost`).
- **Setup-wizard confirm-read gate (A2).** The region step now runs a one-shot OCR
  ("Test read") and won't advance until a plausible reading is shown — or the user
  explicitly skips the check — so a bad crop is caught at setup time.
- **Capture-source-lost banner (D1).** Losing the shared screen/window surfaces a
  prominent banner with a one-click **Reconnect** (auto-re-selects the same source),
  alongside the header health pill and overlay vanish.
- **Content-Security-Policy + navigation guards.** The packaged build ships a strict CSP
  (response header; dev/HMR untouched), and all renderers deny `window.open` / external
  navigation, routing https links to the OS browser.
- **Prod-readiness:** app icon + runtime window icon, main-process crash/error logging to
  `<userData>/logs`, startup update-notification check against GitHub Releases, in-app
  About/help panel (version, loaded table, hotkeys, open-logs), MIT `LICENSE`, Biome
  lint/format config, GitHub Actions CI, and `.nvmrc` (node 24).
- Overlay windows auto-fit height to content (toggleable).

### Changed

- Control window restructured to **4 tabs + an always-visible Results pane**
  (Capture · Match · Overlay · Hotkeys). Per-region calibration verdict, header health
  pill, overlay presets + reset, overlay change-flash, and a sortable scanned-rock card.
- Live OCR stats (confidence / latency / line count / raw text) in the status footer and,
  behind a toggle, on the overlay card.

### Removed

- The low-value signature echo on the overlay (superseded by the live OCR stats).

## [0.3.0] — 2026

- Dropped the signature echo; added live OCR stats to the status footer and an optional
  overlay-card toggle (commits `F1`–`F3`).

## [0.2.0] — 2026

- UI/UX chapter: Survey feature-flag, overlay polish, panel restructure, first-run setup
  wizard, status bar + live preview (commits `U0`–`U4`).

## [0.1.0] — 2026

- First shipped build (ship mining v1): screen capture → PP-OCR read of the Radar
  Signature → constrained-division ore match → live transparent, click-through,
  always-on-top overlay. Phases 0–5; both v1 human-verification gates passed.

[1.0.0-rc.2]: https://github.com/tprjd/sc-ore-overlay/releases/tag/v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/tprjd/sc-ore-overlay/releases/tag/v1.0.0-rc.1
[0.3.0]: https://github.com/tprjd/sc-ore-overlay/releases/tag/v0.3.0
[0.2.0]: https://github.com/tprjd/sc-ore-overlay/releases/tag/v0.2.0
[0.1.0]: https://github.com/tprjd/sc-ore-overlay/releases/tag/v0.1.0

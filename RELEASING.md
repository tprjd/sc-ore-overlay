# RELEASING.md

How **SC Ore Overlay** builds and ships a release. Windows-only target (Star Citizen is
Windows-only), unsigned for now (code signing deferred — see PRODUCTION-READINESS.md).

---

## Current state (as of 2026-06-05)

Releases are **manual** and must be built **on Windows**. There is no release automation
yet — `.github/workflows/ci.yml` runs checks only (lint/typecheck/test on ubuntu) and does
not build the installer.

What exists:

- `npm run dist` = `vite build && electron-builder` → produces the NSIS installer (`.exe`).
- electron-builder config lives in `package.json > build`: Windows `nsis` target, icon,
  and `extraResources` (bundled OCR `models/` + `icon.png`).
- `electron/update.ts` polls `https://api.github.com/repos/tprjd/sc-ore-overlay/releases/latest`
  on startup and shows an in-app "new version" banner. So releases are **expected to live on
  GitHub Releases** with version tags — the in-app updater already depends on that.

What's missing:

- **No `publish` config** in `package.json > build` → electron-builder builds the `.exe` but
  uploads nothing. Artifacts must be attached to the GitHub Release by hand.
- **No release CI** → the installer is only ever built on a local Windows box.
- **No code signing** → unsigned installer triggers a Windows SmartScreen "unknown publisher"
  warning (deferred by decision; document the click-through in the README).

⚠️ **Output-dir collision to fix before automating:** Vite's renderer build `outDir` defaults
to `dist/`, and electron-builder's default output is **also** `dist/`. They clash. A release
setup should pin electron-builder's `directories.output` (e.g. `release/`) so the installer
lands somewhere separate from the renderer bundle.

---

## Manual release steps (today)

1. Bump `version` in `package.json` (e.g. `0.3.0` → `0.4.0`).
2. If the SC patch changed, re-crawl the signature table: `npm run crawl` (commit the result).
3. On a **Windows** machine: `npm ci && npm run dist`.
4. Grab the built installer (currently under `dist/`; see collision note above).
5. Create and push a git tag matching the version: `git tag v0.4.0 && git push origin v0.4.0`.
6. Create a GitHub Release for that tag and upload the `.exe`.
7. `electron/update.ts` will see the newer tag and notify existing users in-app.

---

## Proposed automation (deferred — trigger style TBD)

Add `.github/workflows/release.yml` on `windows-latest` (NSIS + native `sharp` /
`onnxruntime-node` require Windows; the ubuntu CI runner can't build it):

- Steps: `npm ci` → `npm run dist` → upload the installer to the GitHub Release.
- Publish path, pick one:
  - electron-builder `--publish` with `GH_TOKEN` (writes the GitHub Release directly), or
  - `npm run dist` + `softprops/action-gh-release` to attach the `.exe` to an existing Release.
- Trigger options (undecided — revisit later):
  - **Push a `v*` git tag** — bump version, push tag, CI builds + publishes (standard).
  - **`workflow_dispatch`** — manual "Run" button in the Actions UI.
  - **On GitHub Release create** — draft a Release in the UI, CI attaches the installer.

Still unsigned until a code-signing cert / Trusted Signing budget exists. Once signing lands,
revisit full `electron-updater` auto-download/install (PRODUCTION-READINESS.md #5).

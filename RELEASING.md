# RELEASING.md

How **SC Ore Overlay** builds and ships a release. Windows-only target (Star Citizen is
Windows-only), unsigned for now (code signing deferred — see NOTES.md → deferred product
decisions).

---

## Current state (as of 2026-06-05)

Releases are **automated** via `.github/workflows/release.yml` (windows-latest). It builds the
NSIS installer and, on a version tag, attaches it to the matching GitHub Release. The separate
`.github/workflows/ci.yml` still runs checks only (lint/typecheck/test on ubuntu).

What exists:

- `npm run dist` = `vite build && electron-builder` → produces the NSIS installer (`.exe`) under
  `release/` (output dir pinned via `build.directories.output`, see collision note below).
- electron-builder config lives in `package.json > build`: Windows `nsis` target, icon,
  and `extraResources` (bundled OCR `models/` + `icon.png`).
- **Release CI** (`release.yml`): on push of a `v*` tag (or manual `workflow_dispatch`),
  `npm ci → npm run dist`, uploads the installer as a build artifact, and on a tag attaches the
  `.exe` to the GitHub Release (pre-release for tags with a hyphen, e.g. `v1.0.0-rc.1`).
- `electron/update.ts` polls `https://api.github.com/repos/tprjd/sc-ore-overlay/releases/latest`
  on startup and shows an in-app "new version" banner. So releases are **expected to live on
  GitHub Releases** with version tags — the in-app updater already depends on that.

What's still missing:

- **No code signing** → unsigned installer triggers a Windows SmartScreen "unknown publisher"
  warning (deferred by decision; document the click-through in the README).
- **No full auto-update** → the in-app banner links to the Release page for a manual download;
  `electron-updater` auto-install waits on signing.

✅ **Output-dir collision resolved:** Vite's renderer build writes to `dist/`; electron-builder's
output is pinned to `release/` via `build.directories.output`, so the installer no longer clashes
with the renderer bundle.

---

## Release steps (automated)

1. Bump `version` in `package.json` + `package-lock.json` (e.g. `1.0.0-rc.1` → `1.0.0`).
2. If the SC patch changed, re-crawl the signature table: `npm run crawl` (commit the result).
3. Update `CHANGELOG.md` for the new version.
4. Tag and push: `git tag v1.0.0 && git push origin v1.0.0`.
5. `release.yml` runs on the tag: builds the installer on windows-latest and attaches the `.exe`
   to the GitHub Release (auto-created; pre-release if the tag has a hyphen). Release notes are
   auto-generated — edit them / paste the CHANGELOG entry as desired.
6. `electron/update.ts` will see the newer tag and notify existing users in-app.

To build without tagging (smoke test), trigger `release.yml` manually via **workflow_dispatch** —
it uploads the installer as a build artifact and skips the Release attach step.

`softprops/action-gh-release` uses the default `GITHUB_TOKEN` (job has `contents: write`); no PAT
needed. electron-builder runs with no `--publish` flag, so it never uploads on its own — the
artifact upload + Release attach are explicit workflow steps.

Still unsigned until a code-signing cert / Trusted Signing budget exists. Once signing lands,
revisit full `electron-updater` auto-download/install (NOTES.md → deferred product decisions).

// Ensure the installed Electron binary matches the current OS before `npm run
// dev` launches it.
//
// Why this exists: this repo is commonly developed from WSL (Linux) but also
// run natively on Windows against the *same* node_modules. Electron's
// postinstall only fetches the binary for whichever platform ran `npm install`,
// so the other platform hits:
//
//   Error: Electron failed to install correctly, please delete
//   node_modules/electron and try installing again
//
// We detect the mismatch (electron/path.txt vs the current platform) and, when
// it's wrong, do exactly what the error suggests but scoped to the binary:
// remove the stale dist/ + path.txt, then re-run Electron's own install.js so
// it extracts into a clean directory and rewrites path.txt. (Just running
// install.js over the other OS's dist can finish without producing the right
// executable, which is why a plain reinstall wasn't enough.) The download zip
// is cached by @electron/get, so flipping between WSL and Windows re-extracts
// but doesn't re-download. No-op on the platform that already matches.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let electronDir;
try {
  electronDir = dirname(require.resolve('electron/package.json'));
} catch {
  console.error('[ensure-electron] electron is not installed. Run `npm install` first.');
  process.exit(1);
}

const pathFile = join(electronDir, 'path.txt');
const distDir = join(electronDir, 'dist');
const expectsExe = process.platform === 'win32';

/** Is the right-for-this-OS binary present and pointed at by path.txt? */
function installed() {
  if (!existsSync(pathFile)) return false;
  const bin = readFileSync(pathFile, 'utf8').trim();
  // Windows binary is electron.exe; every other platform is a non-.exe name.
  const platformMatches = expectsExe ? bin.endsWith('.exe') : !bin.endsWith('.exe');
  return platformMatches && existsSync(join(distDir, bin));
}

if (installed()) process.exit(0);

console.log(`[ensure-electron] Electron binary missing or built for another OS — reinstalling for ${process.platform}…`);

// Clear stale platform state so install.js extracts into a clean dist and
// rewrites path.txt instead of short-circuiting or merging over the other OS.
try {
  rmSync(pathFile, { force: true });
  rmSync(distDir, { recursive: true, force: true });
} catch (err) {
  console.warn('[ensure-electron] could not clear the stale binary:', err.message);
}

try {
  execFileSync(process.execPath, [join(electronDir, 'install.js')], {
    cwd: electronDir,
    stdio: 'inherit',
  });
} catch (err) {
  console.error('[ensure-electron] reinstall failed:', err.message);
  console.error('[ensure-electron] fallback: delete node_modules/electron and run `npm install`.');
  process.exit(1);
}

if (installed()) {
  console.log('[ensure-electron] ready:', readFileSync(pathFile, 'utf8').trim());
  process.exit(0);
}

console.error('[ensure-electron] still not installed after reinstall. The download may be blocked');
console.error('[ensure-electron] (proxy/firewall) — check the output above, or set ELECTRON_MIRROR.');
process.exit(1);

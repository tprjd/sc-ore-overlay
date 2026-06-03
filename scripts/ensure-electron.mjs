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
// Rather than make the user delete + reinstall, we detect the mismatch (by
// inspecting electron/path.txt vs the current platform) and re-run Electron's
// own installer, which downloads the correct binary (cached by @electron/get,
// so switching back and forth doesn't re-download). No-op on the platform that
// already matches — WSL dev is unaffected.

import { existsSync, readFileSync } from 'node:fs';
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
const expectsExe = process.platform === 'win32';

let ok = false;
if (existsSync(pathFile)) {
  const bin = readFileSync(pathFile, 'utf8').trim();
  // Windows binary is electron.exe; every other platform is a non-.exe name.
  const platformMatches = expectsExe ? bin.endsWith('.exe') : !bin.endsWith('.exe');
  ok = platformMatches && existsSync(join(electronDir, 'dist', bin));
}

if (ok) process.exit(0);

console.log(`[ensure-electron] Electron binary missing or built for another OS — installing for ${process.platform}…`);
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

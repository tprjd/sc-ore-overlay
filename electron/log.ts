// Minimal main-process file logger + crash handlers.
//
// Packaged builds have no console, so without this a thrown error in the main
// process = a silent dead window with no way to diagnose it on a user's machine.
// Lines go to <userData>/logs/main.log (size-capped, one .old rotation), which
// the user can open and share. No network / crashReporter upload — this is local
// diagnostics only (the app is read-only by design; nothing leaves the machine).

import { app } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 1_000_000; // rotate at ~1 MB so the log can't grow unbounded

const logDir = (): string => path.join(app.getPath('userData'), 'logs');
const logFile = (): string => path.join(logDir(), 'main.log');

let dirReady = false;
function ensureDir(): void {
  if (dirReady) return;
  try {
    mkdirSync(logDir(), { recursive: true });
    dirReady = true;
  } catch {
    // ignore — a failed log dir must never take down the app
  }
}

function rotateIfNeeded(file: string): void {
  try {
    if (statSync(file).size > MAX_BYTES) renameSync(file, `${file}.old`);
  } catch {
    // no file yet, or rotate failed — ignore
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

type Level = 'INFO' | 'WARN' | 'ERROR';

function format(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message;
  if (typeof a === 'string') return a;
  return safeJson(a);
}

function write(level: Level, args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level}] ${args.map(format).join(' ')}\n`;
  ensureDir();
  const file = logFile();
  rotateIfNeeded(file);
  try {
    appendFileSync(file, line);
  } catch {
    // ignore write errors
  }
  // Mirror to the console too: harmless in packaged builds (no console), and in
  // `vite dev` it keeps the terminal output developers already rely on.
  const sink = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  sink(line.trimEnd());
}

export const log = {
  info: (...args: unknown[]): void => write('INFO', args),
  warn: (...args: unknown[]): void => write('WARN', args),
  error: (...args: unknown[]): void => write('ERROR', args),
  /** Absolute path to the active log file (e.g. to show in an About panel). */
  path: logFile,
};

/**
 * Wire process- and Electron-level crash signals into the log. Call once, as
 * early as possible (before windows exist) so a startup throw is captured.
 *
 * Deliberately does NOT call app.quit(): a logged-but-surviving main process is
 * better than a hard exit, and the renderer/child handlers are reported, not
 * fatal — the app already recovers from a dead OCR host on its own.
 */
export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => log.error('uncaughtException:', err));
  process.on('unhandledRejection', (reason) => log.error('unhandledRejection:', reason));

  void app.whenReady().then(() => {
    app.on('render-process-gone', (_event, contents, details) => {
      log.error(`render-process-gone [${contents.getTitle()}]:`, details.reason, `exit=${details.exitCode}`);
    });
    app.on('child-process-gone', (_event, details) => {
      log.error(`child-process-gone [${details.type}/${details.name ?? '?'}]:`, details.reason, `exit=${details.exitCode}`);
    });
  });
}

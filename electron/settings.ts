// Persistence to Electron userData: settings.json (small, JSON-pretty) and the
// survey scan log (its own file — it can grow large, kept out of settings.json).
// Pure I/O, no window/IPC deps.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { SurveyEntry } from '../src/core/survey';
import type { AppSettings } from '../src/shared/bridge';

const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json');

export function readSettings(): AppSettings {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8')) as AppSettings;
  } catch {
    return {};
  }
}

export function writeSettings(next: AppSettings): void {
  try {
    mkdirSync(path.dirname(settingsFile()), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  } catch {
    // ignore write errors
  }
}

/** Merge a partial patch into the persisted settings (read-modify-write). */
export function patchSettings(patch: Partial<AppSettings>): void {
  writeSettings({ ...readSettings(), ...patch });
}

/** Delete settings.json (factory reset). */
export function deleteSettings(): void {
  rmSync(settingsFile(), { force: true });
}

const surveyLogFile = (): string => path.join(app.getPath('userData'), 'survey-log.json');

export function readSurveyLog(): SurveyEntry[] {
  try {
    const data = JSON.parse(readFileSync(surveyLogFile(), 'utf8')) as SurveyEntry[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function writeSurveyLog(entries: SurveyEntry[]): void {
  try {
    mkdirSync(path.dirname(surveyLogFile()), { recursive: true });
    writeFileSync(surveyLogFile(), JSON.stringify(entries));
  } catch {
    // ignore write errors
  }
}

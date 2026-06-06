// Global hotkeys: toggle overlay, pause/recalibrate (relayed to the control
// window), and edit-overlay mode. Registration is global so the bindings work
// while the game is focused.

import type { IpcMainInvokeEvent } from 'electron';
import { globalShortcut, ipcMain } from 'electron';
import type { HotkeyAction, HotkeyMap, OverlayCommand } from '../src/shared/bridge';
import { DEFAULT_HOTKEYS } from '../src/shared/bridge';
import { patchSettings, readSettings } from './settings';
import { controlWindow, overlayBoxWindows, toggleEditMode } from './windows';

function toCommand(command: OverlayCommand): void {
  controlWindow()?.webContents.send('sco:command', command);
}

function hotkeyHandlers(): Record<HotkeyAction, () => void> {
  return {
    // Toggle overlay visibility (renderer-side flag — reliable and independent of
    // the idle-fade and of transparent/always-on-top window quirks).
    toggleOverlay: () => {
      for (const w of overlayBoxWindows()) w.webContents.send('sco:overlay-toggle');
    },
    // Pause/resume OCR (handled in the control window).
    pause: () => toCommand('pause'),
    // Re-enter calibration (clear the region) and surface the control window.
    recalibrate: () => {
      toCommand('recalibrate');
      controlWindow()?.show();
    },
    // Toggle "edit overlay" mode.
    editOverlay: () => toggleEditMode(),
  };
}

export function currentHotkeys(): HotkeyMap {
  return { ...DEFAULT_HOTKEYS, ...(readSettings().hotkeys ?? {}) };
}

/**
 * (Re-)register every global hotkey. Returns which bindings registered OK
 * (false = invalid accelerator or already taken by another app).
 */
export function applyHotkeys(map: HotkeyMap): Record<HotkeyAction, boolean> {
  globalShortcut.unregisterAll();
  const handlers = hotkeyHandlers();
  const results = {} as Record<HotkeyAction, boolean>;
  (Object.keys(handlers) as HotkeyAction[]).forEach((action) => {
    const accel = map[action];
    try {
      results[action] = accel ? globalShortcut.register(accel, handlers[action]) : false;
    } catch {
      results[action] = false;
    }
  });
  return results;
}

/** Release all global shortcuts (on quit). */
export function unregisterAllHotkeys(): void {
  globalShortcut.unregisterAll();
}

/** Register the set-hotkeys IPC handler (applies + persists). */
export function registerHotkeyIpc(): void {
  ipcMain.handle(
    'sco:set-hotkeys',
    (_e: IpcMainInvokeEvent, map: HotkeyMap): Record<HotkeyAction, boolean> => {
      const results = applyHotkeys(map);
      patchSettings({ hotkeys: map });
      return results;
    },
  );
}

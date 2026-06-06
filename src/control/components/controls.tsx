// Reusable control-window widgets, extracted from the prospect panel so it and any
// future settings UI share one set of field/section widgets. Pure presentation +
// small local state; no app logic. Styled with Tailwind (control design system).

import { ChevronDown, ChevronRight } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useState } from 'react';

import type { HotkeyAction, HotkeyMap } from '../../shared/bridge';
import { cn } from '../ui/cn';

/** A titled, collapsible block. */
export function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-3 overflow-hidden rounded-lg border border-border bg-surface-alt">
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-2 border-b border-transparent bg-surface px-3 py-2.5 text-left',
          'text-[11px] font-semibold uppercase tracking-wide text-fg/90 transition-colors hover:text-fg',
          open && 'border-border',
        )}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-accent" />
        ) : (
          <ChevronRight className="h-3 w-3 text-accent" />
        )}
        {title}
      </button>
      {open && <div className="p-3">{children}</div>}
    </section>
  );
}

/** Labeled range slider with a value readout. */
export function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  suffix = '',
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="mb-2 flex items-center gap-2">
      <span className="w-[82px] text-xs text-fg/80">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-accent"
      />
      <span className="tnum w-14 text-right text-xs">
        {value}
        {suffix}
      </span>
    </label>
  );
}

/**
 * Comma-separated noise-signature editor. Lets the user manage the list of
 * non-ore signatures (wrecks, sats, etc) that the matcher tries subtracting
 * from a "no match" RS reading. Parses on blur / Enter; ignores garbage.
 */
export function NoiseEditor({
  values,
  onChange,
}: {
  values: number[];
  onChange: (next: number[]) => void;
}) {
  const [text, setText] = useState<string>(values.join(', '));
  useEffect(() => {
    setText(values.join(', '));
  }, [values]);
  const commit = (): void => {
    const next = text
      .split(/[,\s]+/)
      .map((t) => Number.parseInt(t, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    onChange([...new Set(next)].sort((a, b) => a - b));
  };
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <input
        type="text"
        value={text}
        placeholder="10000, 5000, …"
        className="tnum w-full rounded-md border border-border-strong bg-bg px-2 py-1.5 text-[13px] text-fg outline-none transition-colors focus:border-accent/60"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
  );
}

export const HOTKEY_ROWS: Array<[HotkeyAction, string]> = [
  ['toggleOverlay', 'Toggle overlay'],
  ['pause', 'Pause / resume'],
  ['recalibrate', 'Recalibrate'],
  ['editOverlay', 'Edit overlay'],
];

/** Convert a KeyboardEvent key to an Electron accelerator token, or null. */
function normalizeKey(key: string): string | null {
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return null;
  if (key === ' ') return 'Space';
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^F\d{1,2}$/.test(key)) return key;
  const special: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Esc',
    Enter: 'Return',
    Tab: 'Tab',
    Delete: 'Delete',
    Backspace: 'Backspace',
  };
  return special[key] ?? null;
}

/** A button that records the next key combo into an Electron accelerator. */
export function KeyCapture({
  value,
  onChange,
}: {
  value: string;
  onChange: (accel: string) => void;
}) {
  const [capturing, setCapturing] = useState(false);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    if (e.key === 'Escape') {
      setCapturing(false);
      return;
    }
    const mods: string[] = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    const key = normalizeKey(e.key);
    if (!key || mods.length === 0) return; // require at least one modifier + a real key
    onChange([...mods, key].join('+'));
    setCapturing(false);
  };
  return (
    <button
      type="button"
      className={cn(
        'w-full rounded-md border border-border-strong bg-bg px-2 py-1.5 text-left font-mono text-xs text-fg transition-colors',
        capturing && 'border-accent text-accent',
      )}
      onClick={() => setCapturing(true)}
      onKeyDown={capturing ? onKeyDown : undefined}
      onBlur={() => setCapturing(false)}
    >
      {capturing ? 'press combo…' : value}
    </button>
  );
}

/**
 * The full hotkey binding list (one KeyCapture per action + conflict badge),
 * shared by the Mining settings panel and the setup wizard so both edit the same
 * way and stay in sync. Editing is live — `onChange` re-registers immediately.
 */
export function HotkeyEditor({
  hotkeys,
  hotkeyStatus,
  onChange,
}: {
  hotkeys: HotkeyMap;
  hotkeyStatus: Partial<Record<HotkeyAction, boolean>>;
  onChange: (map: HotkeyMap) => void;
}) {
  return (
    <>
      {HOTKEY_ROWS.map(([action, label]) => (
        <div key={action} className="mb-1.5 flex items-center gap-2">
          <span className="w-[82px] text-xs text-fg/80">{label}</span>
          <KeyCapture
            value={hotkeys[action]}
            onChange={(accel) => onChange({ ...hotkeys, [action]: accel })}
          />
          {hotkeyStatus[action] === false && (
            <span className="text-[11px] text-danger">conflict</span>
          )}
        </div>
      ))}
      <p className="text-xs text-muted">
        Click a binding, then press the combo (needs a modifier).
      </p>
    </>
  );
}

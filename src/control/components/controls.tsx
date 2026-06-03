// Reusable control-window primitives, extracted from ScanView so the panel and
// any future settings UI share one set of field/section widgets. Pure
// presentation + small local state; no app logic. Styled via design tokens.

import { useEffect, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import type { HotkeyAction } from '../../shared/bridge';
import { C, F, R } from './tokens';

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
    <section style={s.section}>
      <button
        type="button"
        style={{ ...s.sectionHeader, ...(open ? s.sectionHeaderOpen : null) }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={s.caret}>{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && <div style={s.sectionBody}>{children}</div>}
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
    <label style={s.sliderRow}>
      <span style={s.label}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={s.range}
      />
      <span style={s.sliderValue}>
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
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
      <input
        type="text"
        value={text}
        placeholder="10000, 5000, …"
        style={{ ...s.input, fontVariantNumeric: 'tabular-nums' }}
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
export function KeyCapture({ value, onChange }: { value: string; onChange: (accel: string) => void }) {
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
      style={{ ...s.keyBtn, ...(capturing ? s.keyBtnActive : null) }}
      onClick={() => setCapturing(true)}
      onKeyDown={capturing ? onKeyDown : undefined}
      onBlur={() => setCapturing(false)}
    >
      {capturing ? 'press combo…' : value}
    </button>
  );
}

const s: Record<string, CSSProperties> = {
  section: {
    marginBottom: 12,
    border: `1px solid ${C.border}`,
    borderRadius: R.lg,
    background: C.surfaceAlt,
    overflow: 'hidden',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    background: C.surface,
    border: 'none',
    borderBottom: '1px solid transparent',
    padding: '9px 12px',
    margin: 0,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: C.text,
    opacity: 0.9,
    textAlign: 'left',
  },
  // When open, divide the header from the body with a hairline.
  sectionHeaderOpen: { borderBottom: `1px solid ${C.border}` },
  sectionBody: { padding: 12 },
  caret: { fontSize: 10, width: 10, display: 'inline-block', color: C.accent },
  label: { width: 82, fontSize: 12, opacity: 0.8 },
  sliderRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  range: { flex: 1 },
  sliderValue: { width: 56, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' },
  input: { flex: 1, background: C.bg, color: C.text, border: `1px solid ${C.borderStrong}`, borderRadius: R.md, padding: '6px 8px', fontSize: 13 },
  keyBtn: { flex: 1, background: C.bg, color: C.text, border: `1px solid ${C.borderStrong}`, borderRadius: R.md, padding: '5px 8px', fontSize: 12, fontFamily: F.mono, cursor: 'pointer', textAlign: 'left' },
  keyBtnActive: { borderColor: C.accent, color: C.accent },
};

// Small form primitives shared by the settings panel and the wizard: a themed
// text input, a checkbox row with optional hint, and a label+control "field row"
// (the old `selectRow` pattern — fixed-width label on the left, control filling).

import type { ReactNode } from 'react';
import { forwardRef } from 'react';
import { cn } from './cn';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-md border border-border-strong bg-bg px-2.5 py-1.5 text-sm text-fg outline-none transition-colors',
        'placeholder:text-muted/60 focus:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

/** Label + control on one row; `labelWidth` keeps a column of labels aligned. */
export function FieldRow({
  label,
  children,
  className,
  labelWidth = 82,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  labelWidth?: number;
}) {
  // A plain div (not <label>): the control may be a Radix Select whose trigger
  // isn't a native input, so a <label> wouldn't associate anyway.
  return (
    <div className={cn('mb-2.5 flex items-center gap-2', className)}>
      <span className="shrink-0 text-xs text-fg/80" style={{ width: labelWidth }}>
        {label}
      </span>
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  );
}

/** Checkbox + label (with optional secondary hint line). */
export function CheckRow({
  checked,
  onChange,
  label,
  hint,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('mb-2.5 flex items-start gap-2 text-xs leading-snug', className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>{label}</span>
        {hint && <span className="text-[11px] text-muted/70">{hint}</span>}
      </span>
    </label>
  );
}

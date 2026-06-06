// Horizontal step indicator for the setup wizard. Numbered dots, connecting
// lines, and active/done/idle states; optional steps get a subtle "optional" tag.

import { Check } from 'lucide-react';
import { Fragment } from 'react';
import { cn } from './cn';

export interface StepItem {
  /** Stable key + the visible label. */
  label: string;
  /** Marked with a lighter "optional" hint under the label. */
  optional?: boolean;
}

export function Stepper({
  steps,
  current,
  className,
}: {
  steps: StepItem[];
  /** Index of the active step. Earlier steps render as done. */
  current: number;
  className?: string;
}) {
  return (
    <ol className={cn('flex items-center gap-1', className)}>
      {steps.map((step, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'idle';
        return (
          <Fragment key={step.label}>
            {i > 0 && (
              <li
                aria-hidden
                className={cn('h-px flex-1 min-w-4', i <= current ? 'bg-accent/50' : 'bg-border')}
              />
            )}
            <li className="flex items-center gap-2">
              <span
                className={cn(
                  'grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-bold transition-colors',
                  state === 'active' && 'border-accent bg-accent text-bg',
                  state === 'done' && 'border-green/50 bg-green/15 text-green',
                  state === 'idle' && 'border-border-strong bg-surface text-muted',
                )}
              >
                {state === 'done' ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="flex flex-col leading-tight">
                <span
                  className={cn(
                    'text-xs',
                    state === 'idle' ? 'text-muted' : 'text-fg',
                    state === 'active' && 'font-semibold',
                  )}
                >
                  {step.label}
                </span>
                {step.optional && (
                  <span className="text-[10px] uppercase tracking-wide text-muted/70">
                    optional
                  </span>
                )}
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

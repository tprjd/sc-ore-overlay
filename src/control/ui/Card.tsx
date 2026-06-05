// Surface primitives: Card (bordered panel) + a small Section wrapper used by
// the settings groups. Plain styled divs — no behavior.

import { cn } from './cn';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-surface', className)} {...props} />;
}

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm bg-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide opacity-80',
        className,
      )}
      {...props}
    />
  );
}

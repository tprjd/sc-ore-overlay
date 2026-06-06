// Styled Radix Select. Replaces native <select> across the control UI so the
// dropdown matches the dark theme and gets keyboard/focus handling for free.
// Supports grouped options (SelectGroup + SelectLabel) like the old <optgroup>.

import * as RS from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from './cn';

export const Select = RS.Root;
export const SelectGroup = RS.Group;
export const SelectValue = RS.Value;

export const SelectTrigger = forwardRef<
  React.ElementRef<typeof RS.Trigger>,
  React.ComponentPropsWithoutRef<typeof RS.Trigger>
>(({ className, children, ...props }, ref) => (
  <RS.Trigger
    ref={ref}
    className={cn(
      'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border-strong bg-bg px-2.5 text-sm text-fg',
      'transition-colors hover:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
      'data-[placeholder]:text-muted disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    {children}
    <RS.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-60" />
    </RS.Icon>
  </RS.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

export const SelectContent = forwardRef<
  React.ElementRef<typeof RS.Content>,
  React.ComponentPropsWithoutRef<typeof RS.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <RS.Portal>
    <RS.Content
      ref={ref}
      position={position}
      className={cn(
        'z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-md border border-border-strong bg-surface text-fg shadow-xl',
        'data-[state=open]:animate-[sco-fade-in_120ms_ease-out]',
        position === 'popper' && 'w-[var(--radix-select-trigger-width)]',
        className,
      )}
      {...props}
    >
      <RS.Viewport className="p-1">{children}</RS.Viewport>
    </RS.Content>
  </RS.Portal>
));
SelectContent.displayName = 'SelectContent';

export const SelectLabel = forwardRef<
  React.ElementRef<typeof RS.Label>,
  React.ComponentPropsWithoutRef<typeof RS.Label>
>(({ className, ...props }, ref) => (
  <RS.Label
    ref={ref}
    className={cn('px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted', className)}
    {...props}
  />
));
SelectLabel.displayName = 'SelectLabel';

export const SelectItem = forwardRef<
  React.ElementRef<typeof RS.Item>,
  React.ComponentPropsWithoutRef<typeof RS.Item>
>(({ className, children, ...props }, ref) => (
  <RS.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pr-7 pl-2 text-sm outline-none',
      'data-[highlighted]:bg-accent/15 data-[highlighted]:text-accent data-[state=checked]:text-accent',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
      className,
    )}
    {...props}
  >
    <RS.ItemText>{children}</RS.ItemText>
    <span className="absolute right-2 inline-flex items-center">
      <RS.ItemIndicator>
        <Check className="h-3.5 w-3.5" />
      </RS.ItemIndicator>
    </span>
  </RS.Item>
));
SelectItem.displayName = 'SelectItem';

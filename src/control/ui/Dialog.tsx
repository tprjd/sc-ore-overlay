// Styled Radix Dialog — used for confirms (e.g. factory reset). Re-exports the
// Radix parts plus a themed Overlay + Content so call sites stay terse.

import * as RD from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from './cn';

export const Dialog = RD.Root;
export const DialogTrigger = RD.Trigger;
export const DialogClose = RD.Close;
export const DialogTitle = forwardRef<
  React.ElementRef<typeof RD.Title>,
  React.ComponentPropsWithoutRef<typeof RD.Title>
>(({ className, ...props }, ref) => (
  <RD.Title ref={ref} className={cn('text-base font-bold text-fg', className)} {...props} />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = forwardRef<
  React.ElementRef<typeof RD.Description>,
  React.ComponentPropsWithoutRef<typeof RD.Description>
>(({ className, ...props }, ref) => (
  <RD.Description
    ref={ref}
    className={cn('mt-2 text-sm leading-relaxed text-muted', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';

export const DialogContent = forwardRef<
  React.ElementRef<typeof RD.Content>,
  React.ComponentPropsWithoutRef<typeof RD.Content> & { showClose?: boolean }
>(({ className, children, showClose = true, ...props }, ref) => (
  <RD.Portal>
    <RD.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-[sco-fade-in_120ms_ease-out]" />
    <RD.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
        'rounded-xl border border-border-strong bg-surface p-5 shadow-2xl',
        'data-[state=open]:animate-[sco-pop-in_140ms_ease-out] focus:outline-none',
        className,
      )}
      {...props}
    >
      {children}
      {showClose && (
        <RD.Close
          className="absolute right-3 top-3 rounded-sm p-1 text-muted transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </RD.Close>
      )}
    </RD.Content>
  </RD.Portal>
));
DialogContent.displayName = 'DialogContent';

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-5 flex justify-end gap-2', className)} {...props} />;
}

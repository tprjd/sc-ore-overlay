// Styled Radix Tooltip. A single <TooltipProvider> wraps the app (in main.tsx);
// call sites use <Tooltip><TooltipTrigger/><TooltipContent/></Tooltip>.

import * as RT from '@radix-ui/react-tooltip';
import { forwardRef } from 'react';
import { cn } from './cn';

export const TooltipProvider = RT.Provider;
export const Tooltip = RT.Root;
export const TooltipTrigger = RT.Trigger;

export const TooltipContent = forwardRef<
  React.ElementRef<typeof RT.Content>,
  React.ComponentPropsWithoutRef<typeof RT.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <RT.Portal>
    <RT.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-md border border-border-strong bg-bg px-2.5 py-1.5 text-xs text-fg shadow-xl',
        'data-[state=delayed-open]:animate-[sco-fade-in_120ms_ease-out]',
        className,
      )}
      {...props}
    />
  </RT.Portal>
));
TooltipContent.displayName = 'TooltipContent';

// Button primitive. cva-driven variants/sizes; `asChild` (Radix Slot) lets it
// wrap an <a>/<label>/Radix trigger without an extra DOM node. Replaces the
// repeated inline button styles across the old control components.

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef } from 'react';
import { cn } from './cn';

const button = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium ' +
    'transition-colors duration-150 cursor-pointer ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-0 ' +
    'disabled:cursor-not-allowed disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-bg font-bold hover:bg-accent/85 active:bg-accent/75',
        secondary:
          'bg-btn text-fg border border-border-strong hover:bg-[#343a47] active:bg-[#3a4150]',
        ghost: 'bg-transparent text-fg hover:bg-white/5 active:bg-white/10',
        danger: 'bg-danger text-[#1a0d0d] font-bold hover:bg-danger/85 active:bg-danger/75',
        link: 'bg-transparent text-muted underline underline-offset-2 hover:text-fg px-0 py-0 h-auto',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-9 px-3.5 text-sm',
        lg: 'h-10 px-5 text-sm',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        // Default to type="button" so buttons never submit a stray form.
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(button({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

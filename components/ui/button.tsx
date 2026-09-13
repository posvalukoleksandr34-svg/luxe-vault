'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { playClickSound, playHoverSound } from '@/lib/audio/ui-sound';
import { cn } from '@/lib/utils';

/**
 * Sizes carry a mobile step: h-11 (44px) below md, the smallest target the
 * iOS and Android accessibility guidelines accept, dropping to the compact
 * desktop height where the pointer is precise. `sm` stays 44px on a phone for
 * the same reason — "small" is a density choice, not permission to make a
 * control hard to hit with a thumb.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium leading-normal ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-4 py-2 md:h-10',
        sm: 'h-11 rounded-md px-3 md:h-9',
        lg: 'h-12 rounded-md px-8 md:h-11',
        icon: 'h-11 w-11 md:h-10 md:w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

/**
 * Sound is wired here as well as in the delegated document layer
 * (lib/audio/global-feedback.ts) — the primitive says out loud that a button
 * ticks on hover and clicks on press, rather than leaving it to a listener
 * somewhere else. Both report the same press; playClickSound is idempotent
 * within 40 ms, so it is heard once.
 *
 * The component's own handlers run FIRST and are never replaced: sound must
 * not be able to swallow a click.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, onClick, onMouseEnter, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          onClick?.(event);
          playClickSound();
        }}
        onMouseEnter={(event: React.MouseEvent<HTMLButtonElement>) => {
          onMouseEnter?.(event);
          playHoverSound();
        }}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };

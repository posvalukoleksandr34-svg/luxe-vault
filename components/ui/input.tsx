import * as React from 'react';

import { cn } from '@/lib/utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // text-base below md is not a style choice: iOS zooms the page when
          // a focused field's text is under 16px and never zooms back out.
          // h-11 is the 44px touch target; both step down at md, where the
          // pointer is precise and the design is compact. See the mobile form
          // block in globals.css, which enforces the same floor app-wide.
          'flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-base leading-normal ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:px-3 md:text-sm',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };

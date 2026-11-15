import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// shadcn/ui Button, themed with FreeRoom tokens (asChild/Slot omitted until needed).
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-brown text-white hover:bg-brown-700',
        outline: 'border border-line bg-surface text-espresso hover:bg-cream',
        ghost: 'text-espresso hover:bg-cream',
        light: 'bg-white/15 text-white hover:bg-white/25',
      },
      // 44px touch targets on phones; compact on desktop.
      size: {
        default: 'h-11 px-4 md:h-10',
        sm: 'h-11 px-3 text-xs md:h-8',
        lg: 'h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export const inputClass =
  // 16px on phones so iOS doesn't zoom on focus.
  'h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-base text-espresso placeholder:text-muted/70 md:h-10 md:text-sm';

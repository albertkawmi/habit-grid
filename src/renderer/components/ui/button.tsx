import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-1 rounded-md font-medium',
    'transition-[background-color,color,opacity,transform] duration-100',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
    'disabled:pointer-events-none disabled:opacity-40 active:scale-[0.97]'
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:brightness-110',
        subtle: 'bg-surface-raised text-ink ring-1 ring-line hover:bg-cell',
        ghost: 'text-ink-muted hover:bg-cell hover:text-ink',
        danger: 'text-ink-faint hover:bg-danger/12 hover:text-danger'
      },
      size: {
        sm: 'h-6 px-2 text-[11px]',
        md: 'h-7 px-2.5 text-[11px]',
        icon: 'h-6 w-6',
        'icon-xs': 'h-4 w-4 rounded'
      }
    },
    defaultVariants: { variant: 'subtle', size: 'md' }
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
)
Button.displayName = 'Button'

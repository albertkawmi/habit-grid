import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-7 w-full min-w-0 rounded-md bg-surface-raised px-2 text-[11px] text-ink',
        'ring-1 ring-line transition-shadow duration-100',
        'placeholder:text-ink-faint',
        'focus:outline-none focus:ring-2 focus:ring-accent/60',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'

import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/shared/lib/utils'
import { focusRing } from './field-classes'

/**
 * Design system Button: 32px, radius 4, 13px medium, no shadow. One `default` (teal) per view;
 * `outline` for secondary actions; `ink` for a main action when teal is already used;
 * `destructive` only inside a confirmation.
 */
const buttonVariants = cva(
  `inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-sm font-medium transition-colors ${focusRing} disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0`,
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active',
        ink: 'bg-ink text-ink-foreground hover:bg-ink-hover',
        secondary: 'bg-muted text-foreground hover:bg-muted-strong',
        outline: 'border-border bg-card text-foreground hover:border-border-strong hover:bg-gray-50',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive-hover',
        link: 'text-link underline-offset-[3px] hover:underline',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2 text-xs',
        lg: 'h-9 px-4 text-base',
        icon: 'h-8 w-8',
        'icon-sm': 'h-7 w-7',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/shared/lib/utils'

/**
 * White, hairline border, radius 6, padding 10×12; only the 15px icon carries the tone.
 * Usage: <Alert variant="warning"><TriangleAlert /><AlertTitle>…</AlertTitle><AlertDescription>…</AlertDescription></Alert>
 * No live role by default (a static « Lecture seule » notice must not be announced): pass
 * `role="alert"` for an error that appears after an action, `role="status"` for a polite update.
 */
const alertVariants = cva(
  'relative grid w-full grid-cols-[1fr] items-start gap-x-2.5 gap-y-px rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground has-[>svg]:grid-cols-[15px_1fr] [&>svg~*]:col-start-2 [&>svg]:mt-0.5 [&>svg]:size-[15px] [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: '[&>svg]:text-muted-foreground',
        destructive: '[&>svg]:text-destructive',
        warning: '[&>svg]:text-warning',
        success: '[&>svg]:text-success',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
))
Alert.displayName = 'Alert'

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn('text-sm font-medium text-foreground', className)}
    {...props}
  />
))
AlertTitle.displayName = 'AlertTitle'

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
))
AlertDescription.displayName = 'AlertDescription'

export { Alert, AlertTitle, AlertDescription }

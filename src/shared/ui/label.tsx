import * as React from 'react'
import { cn } from '@/shared/lib/utils'

/** 13px medium ink. Required markers are FormField's job. */
const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('block text-sm font-medium text-foreground', className)} {...props} />
  )
)
Label.displayName = 'Label'

export { Label }

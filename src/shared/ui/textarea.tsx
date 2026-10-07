import * as React from 'react'
import { cn } from '@/shared/lib/utils'
import { fieldClasses } from './field-classes'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(fieldClasses, 'flex min-h-24 resize-y px-2.5 py-2', className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }

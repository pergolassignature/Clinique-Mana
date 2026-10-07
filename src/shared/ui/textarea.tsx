import * as React from 'react'
import { cn } from '@/shared/lib/utils'
import { fieldClasses } from './field-classes'
import { useFieldReadOnly } from './read-only-context'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, readOnly: readOnlyProp, placeholder, ...props }, ref) => {
    const readOnly = useFieldReadOnly(readOnlyProp)
    return (
      <textarea
        className={cn(fieldClasses, 'flex min-h-24 resize-y px-2.5 py-2', className)}
        ref={ref}
        readOnly={readOnly}
        placeholder={readOnly ? undefined : placeholder}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }

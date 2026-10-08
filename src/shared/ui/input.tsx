import * as React from 'react'
import { cn } from '@/shared/lib/utils'
import { fieldClasses } from './field-classes'
import { useFieldReadOnly } from './read-only-context'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/**
 * Design system Input. Read-only (`readOnly`, or inside a read-only SettingsCard) keeps the value
 * focusable and copyable, and drops the placeholder, which would read as a value.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, readOnly: readOnlyProp, placeholder, ...props }, ref) => {
    const readOnly = useFieldReadOnly(readOnlyProp)
    return (
      <input
        type={type}
        className={cn(
          fieldClasses,
          'flex h-8 px-2.5 tabular file:border-0 file:bg-transparent file:text-sm file:font-medium',
          className
        )}
        ref={ref}
        readOnly={readOnly}
        placeholder={readOnly ? undefined : placeholder}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }

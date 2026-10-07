import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { fieldClasses } from './field-classes'

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** A disabled empty first option (« Choisir… »), shown muted while it is selected. */
  placeholder?: string
}

/**
 * Native select styled like Input, with a 14px chevron 8px from the right.
 *
 * With a `placeholder`, the muted colour is pure CSS (`:has(> option[value='']:checked)`): it
 * follows the DOM value whatever sets it (user, `value`, react-hook-form `register()`,
 * `setValue`, `reset`). Without `value` or `defaultValue`, the select starts on the placeholder;
 * otherwise the browser would silently select the first real option.
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, placeholder, ...props }, ref) => {
    const startEmpty = placeholder !== undefined && props.value === undefined && props.defaultValue === undefined
    return (
      <div className="relative">
        <select
          className={cn(
            fieldClasses,
            'flex h-8 cursor-pointer appearance-none pl-2.5 pr-7',
            placeholder && "[&:has(>option[value='']:checked)]:text-subtle",
            className
          )}
          ref={ref}
          {...(startEmpty ? { defaultValue: '' } : {})}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" aria-hidden />
      </div>
    )
  }
)
Select.displayName = 'Select'

export { Select }

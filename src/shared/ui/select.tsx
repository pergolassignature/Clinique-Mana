import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { fieldClasses } from './field-classes'

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  placeholder?: string
}

/**
 * Native select styled like Input, with a 14px chevron 8px from the right. With a `placeholder`,
 * the text is muted while nothing is chosen.
 *
 * Emptiness is read from the DOM, not from the `value` prop, so it also holds for uncontrolled
 * selects (react-hook-form `register()`, `defaultValue`): on change, and after every render,
 * which catches values set through the ref (register's default, `reset()`, which re-renders the form).
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, placeholder, onChange, ...props }, ref) => {
    const innerRef = React.useRef<HTMLSelectElement | null>(null)
    const [isEmpty, setIsEmpty] = React.useState(() => (props.value ?? props.defaultValue ?? '') === '')

    const setRefs = React.useCallback(
      (node: HTMLSelectElement | null) => {
        innerRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      },
      [ref]
    )

    // No dependency array on purpose: the DOM value can change without a change event.
    // setIsEmpty bails out when the value is unchanged, so this never loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs after every render on purpose (see above)
    React.useLayoutEffect(() => {
      if (innerRef.current) setIsEmpty(innerRef.current.value === '')
    })

    return (
      <div className="relative">
        <select
          className={cn(
            fieldClasses,
            'flex h-8 cursor-pointer appearance-none pl-2.5 pr-7',
            placeholder && isEmpty && 'text-subtle',
            className
          )}
          ref={setRefs}
          onChange={(e) => {
            setIsEmpty(e.target.value === '')
            onChange?.(e)
          }}
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

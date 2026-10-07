import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { fieldClasses } from './field-classes'
import { Input } from './input'
import { useFieldReadOnly } from './read-only-context'

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** A disabled empty first option (« Choisir… »), shown muted while it is selected. */
  placeholder?: string
  /** The placeholder option can be chosen again, to clear an optional value (stored as null). */
  clearable?: boolean
  /**
   * Shows the chosen option's label in a read-only text input (a `<select>` has no read-only
   * state, and disabled text is hard to read and cannot be tabbed to). Pass `value` (e.g. through
   * react-hook-form's `Controller`) or `defaultValue`: a `register()`ed select keeps its value in
   * the DOM, which the read-only input cannot read. Defaults to the surrounding context.
   */
  readOnly?: boolean
}

/** The text of the `<option>` whose value is `value`, searched through fragments, arrays and optgroups. */
function optionLabel(children: React.ReactNode, value: string): string | undefined {
  for (const child of React.Children.toArray(children)) {
    if (!React.isValidElement<{ value?: unknown; children?: React.ReactNode }>(child)) continue
    if (child.type === 'option') {
      const optionValue = child.props.value ?? React.Children.toArray(child.props.children).join('')
      if (String(optionValue) === value) return React.Children.toArray(child.props.children).join('')
    } else {
      const found = optionLabel(child.props.children, value)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/** The attributes a read-only stand-in keeps from the select: identity and accessibility. */
function readOnlyAttributes(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const kept: Record<string, unknown> = { id: props.id, name: props.name, title: props.title }
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith('aria-') || key.startsWith('data-')) kept[key] = value
  }
  return kept as React.InputHTMLAttributes<HTMLInputElement>
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
  ({ className, children, placeholder, clearable = false, readOnly: readOnlyProp, ...props }, ref) => {
    const readOnly = useFieldReadOnly(readOnlyProp)
    if (readOnly) {
      const raw = props.value ?? props.defaultValue
      const value = raw === undefined || raw === null ? '' : String(raw)
      const label = value === '' ? '' : (optionLabel(children, value) ?? value)
      return <Input {...readOnlyAttributes(props)} className={className} readOnly value={label} />
    }
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
            <option value="" disabled={!clearable}>
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

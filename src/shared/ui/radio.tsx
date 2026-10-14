import * as React from 'react'
import { cn } from '@/shared/lib/utils'
import { focusRing } from './field-classes'

/**
 * A radio button drawn by us, the Checkbox's sibling: 16px, the same #8E8E92 border unchecked
 * (decision #30); checked = teal fill with a 6px white dot. The browser's own radio is not drawn:
 * `accent-color` is not honoured the same way by every browser and system (the owner saw the
 * checked dot grey). A disabled radio fades, except the checked one: it still says what was chosen
 * (« Publier » a first consent version). A native input still, so `name`, arrows, forms and labels
 * work as before; in forced colours the system's radio comes back.
 */
export const Radio = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="radio"
    className={cn(
      'size-4 shrink-0 cursor-pointer appearance-none rounded-full border border-subtle bg-card transition-colors duration-120',
      'checked:border-primary checked:bg-primary checked:bg-[radial-gradient(circle,rgb(var(--primary-fg))_0_3px,transparent_3.5px)]',
      'disabled:cursor-not-allowed disabled:opacity-50 disabled:checked:opacity-100 forced-colors:appearance-auto',
      focusRing,
      className,
    )}
    {...props}
  />
))
Radio.displayName = 'Radio'

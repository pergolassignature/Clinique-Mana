import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { focusRing } from './field-classes'

/**
 * 16px, radius 3; the unchecked border is #8E8E92 (3.3:1, decision #30) rather than the design
 * system's #CFCFD4. Checked = teal fill with a 12px white check. An invisible ::after enlarges the
 * hit area to 32×32 without changing the look.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      `peer relative h-4 w-4 shrink-0 rounded-sm border border-subtle bg-card after:absolute after:-inset-2 after:content-[''] text-primary-foreground transition-colors duration-120 ${focusRing} disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary`,
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn('flex items-center justify-center text-current')}
    >
      <Check className="h-3 w-3" strokeWidth={2.5} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }

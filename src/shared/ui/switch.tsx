import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/shared/lib/utils'
import { focusRing } from './field-classes'
import { useFieldReadOnly } from './read-only-context'

/**
 * 32×18 track, 14px white thumb travelling 14px. The off track is #8E8E92 (3.3:1, decision #30)
 * rather than the design system's #D4D4D8 (1.5:1), so the state is visible. An invisible ::after
 * enlarges the hit area to 32×32 (the border is 2px, hence the -9px / -2px insets).
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
    /** Shows the state without letting it change (inside a read-only SettingsCard by default). */
    readOnly?: boolean
  }
>(
  (
    { className, readOnly: readOnlyProp, onCheckedChange, onClick, ...props },
    ref
  ) => {
    const readOnly = useFieldReadOnly(readOnlyProp)
    return (
      <SwitchPrimitive.Root
        ref={ref}
        aria-readonly={readOnly || undefined}
        onCheckedChange={readOnly ? undefined : onCheckedChange}
        // Click, Space and Enter all reach the button as a click: preventing it skips Radix's toggle.
        onClick={(event) => {
          onClick?.(event)
          if (readOnly) event.preventDefault()
        }}
        className={cn(
          `peer relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors after:absolute after:-inset-x-0.5 after:-inset-y-[9px] after:content-[''] ${focusRing} disabled:cursor-not-allowed disabled:opacity-50 aria-readonly:cursor-default data-[state=checked]:bg-primary data-[state=unchecked]:bg-subtle`,
          className
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.15)] ring-0 transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0'
          )}
        />
      </SwitchPrimitive.Root>
    )
  }
)
Switch.displayName = SwitchPrimitive.Root.displayName

export { Switch }

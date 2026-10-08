import { forwardRef, useId } from 'react'
import { Label } from '@/shared/ui/label'
import { Switch } from '@/shared/ui/switch'

interface SwitchFieldProps {
  label: string
  help?: string
  error?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  onBlur?: () => void
}

/**
 * A form's on/off value: label and help on the left, the switch on the right, help and error read
 * through `aria-describedby` (as FormField). Space or a click toggles it, never an arrow key
 * (decision #39); it changes the form's draft only (decision #36).
 *
 * The ref reaches the switch itself: pass react-hook-form's `field.ref` so a failed submit focuses it.
 */
export const SwitchField = forwardRef<HTMLButtonElement, SwitchFieldProps>(function SwitchField(
  { label, help, error, checked, onCheckedChange, onBlur },
  ref,
) {
  const id = useId()
  const helpId = help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        {help && (
          <p id={helpId} className="text-xs text-muted-foreground">
            {help}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <Switch
        ref={ref}
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        onBlur={onBlur}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className="mt-0.5"
      />
    </div>
  )
})

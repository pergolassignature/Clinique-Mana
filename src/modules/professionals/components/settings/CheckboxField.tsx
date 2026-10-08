import { useId } from 'react'
import { Checkbox } from '@/shared/ui/checkbox'
import { Label } from '@/shared/ui/label'

interface CheckboxFieldProps {
  label: string
  help?: string
  error?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  onBlur?: () => void
}

/**
 * A checkbox with its label to the right, then its help and error, read through
 * `aria-describedby` (as FormField). Toggling changes the form's draft only (decision #36).
 */
export function CheckboxField({ label, help, error, checked, onCheckedChange, onBlur }: CheckboxFieldProps) {
  const id = useId()
  const helpId = help ? `${id}-help` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        onBlur={onBlur}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className="mt-0.5"
      />
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
    </div>
  )
}

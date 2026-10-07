import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { ignoreWhenInactive, softDisabledClasses } from './soft-disabled'

interface SaveButtonProps {
  /** A save is in flight: reads `pendingLabel` and ignores presses. */
  pending?: boolean
  /** Inactive (e.g. nothing changed): ignores presses. */
  disabled?: boolean
  /** Another verb for the action (« Changer le courriel »); « Enregistrer » by default. */
  label?: string
  /** « Enregistrement… » by default. */
  pendingLabel?: string
  /** `outline` while there is nothing to save (see FormActions); the teal `default` otherwise. */
  variant?: 'default' | 'outline'
}

/** While inactive, each variant keeps its resting fill on hover and press. */
const INACTIVE_PINS = {
  default: 'aria-disabled:hover:bg-primary aria-disabled:active:bg-primary',
  outline: 'aria-disabled:hover:border-border aria-disabled:hover:bg-card',
} as const

/**
 * The submit button of a SettingsCard (or any form): « Enregistrer » / « Enregistrement… ».
 * When inactive it is `aria-disabled` rather than `disabled`, so keyboard focus stays on it while
 * saving and after a save; presses (and Enter in a field) are ignored meanwhile.
 */
export function SaveButton({
  pending = false,
  disabled = false,
  label = t('common.save'),
  pendingLabel = t('common.saving'),
  variant = 'default',
}: SaveButtonProps) {
  const inactive = disabled || pending
  return (
    <Button
      type="submit"
      variant={variant}
      aria-disabled={inactive || undefined}
      onClick={ignoreWhenInactive(inactive)}
      className={cn(softDisabledClasses, INACTIVE_PINS[variant])}
    >
      {pending ? pendingLabel : label}
    </Button>
  )
}

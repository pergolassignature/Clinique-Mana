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
}

/**
 * The submit button of a SettingsCard (or any form): « Enregistrer » / « Enregistrement… ».
 * When inactive it is `aria-disabled` rather than `disabled`, so keyboard focus stays on it while
 * saving and after a save; presses (and Enter in a field) are ignored meanwhile.
 */
export function SaveButton({ pending = false, disabled = false, label = t('common.save'), pendingLabel = t('common.saving') }: SaveButtonProps) {
  const inactive = disabled || pending
  return (
    <Button
      type="submit"
      aria-disabled={inactive || undefined}
      onClick={ignoreWhenInactive(inactive)}
      className={cn(softDisabledClasses, 'aria-disabled:hover:bg-primary aria-disabled:active:bg-primary')}
    >
      {pending ? pendingLabel : label}
    </Button>
  )
}

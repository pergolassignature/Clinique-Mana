import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'

interface SaveButtonProps {
  /** A save is in flight: reads `pendingLabel` and cannot be pressed again. */
  pending?: boolean
  disabled?: boolean
  /** Another verb for the action (« Changer le courriel »); « Enregistrer » by default. */
  label?: string
  /** « Enregistrement… » by default. */
  pendingLabel?: string
}

/** The submit button of a SettingsCard (or any form): « Enregistrer » / « Enregistrement… ». */
export function SaveButton({ pending = false, disabled = false, label = t('common.save'), pendingLabel = t('common.saving') }: SaveButtonProps) {
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? pendingLabel : label}
    </Button>
  )
}

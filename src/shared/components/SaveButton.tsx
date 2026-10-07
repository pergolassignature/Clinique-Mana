import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'

interface SaveButtonProps {
  /** A save is in flight: reads « Enregistrement… » and cannot be pressed again. */
  pending?: boolean
  disabled?: boolean
}

/** The submit button of a SettingsCard (or any form): « Enregistrer » / « Enregistrement… ». */
export function SaveButton({ pending = false, disabled = false }: SaveButtonProps) {
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? t('common.saving') : t('common.save')}
    </Button>
  )
}

import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { SaveButton } from './SaveButton'

interface FormActionsProps {
  /** Puts the form back to its last saved values (e.g. react-hook-form's `reset()`). */
  onCancel: () => void
  /** The form has unsaved changes: both buttons are enabled only then. */
  dirty: boolean
  /** A save is in flight: both buttons are disabled, the submit button says so. */
  pending?: boolean
  /** Another verb for the submit button (see SaveButton); « Enregistrer » by default. */
  submitLabel?: string
  pendingLabel?: string
}

/**
 * A form's footer pair, « Annuler / Enregistrer » (design system: aligned right, outline then
 * default). Pass it as a SettingsCard `footer`, which aligns it. « Annuler » is a plain button:
 * it never submits.
 */
export function FormActions({ onCancel, dirty, pending = false, submitLabel, pendingLabel }: FormActionsProps) {
  return (
    <>
      <Button type="button" variant="outline" onClick={onCancel} disabled={!dirty || pending}>
        {t('common.cancel')}
      </Button>
      <SaveButton pending={pending} disabled={!dirty} label={submitLabel} pendingLabel={pendingLabel} />
    </>
  )
}

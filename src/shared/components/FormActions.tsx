import { useEffect, useState } from 'react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { SaveButton } from './SaveButton'
import { ignoreWhenInactive, softDisabledClasses } from './soft-disabled'

interface FormActionsProps {
  /** Puts the form back to its last saved values (e.g. react-hook-form's `reset()`). */
  onCancel: () => void
  /**
   * Runs once the form has re-rendered after `onCancel`, e.g. `() => form.setFocus('firstField')`
   * to send keyboard focus back to the form (react-hook-form's reset() re-registers the fields on
   * that render, so focusing earlier would miss them). Without it, focus stays on « Annuler ».
   */
  onReset?: () => void
  /** The form has unsaved changes: both buttons are active only then. */
  dirty: boolean
  /** A save is in flight: both buttons are inactive, the submit button says so. */
  pending?: boolean
  /** Another verb for the submit button (see SaveButton); « Enregistrer » by default. */
  submitLabel?: string
  pendingLabel?: string
}

/**
 * The footer of a SettingsCard form: « Annuler / Enregistrer » (design system: outline then
 * default, aligned right by the card). Not a dialog footer: here « Annuler » means « discard my
 * edits », so it is inactive while nothing changed, whereas a dialog's « Annuler » always closes.
 *
 * Both buttons are `aria-disabled` rather than `disabled` when inactive, so keyboard focus stays
 * on them while saving, after a save and after « Annuler »; presses are ignored meanwhile.
 * « Annuler » is a plain button: it never submits.
 */
export function FormActions({ onCancel, onReset, dirty, pending = false, submitLabel, pendingLabel }: FormActionsProps) {
  const cancelInactive = !dirty || pending
  // Counts the « Annuler » presses: each one runs onReset after the render it caused.
  const [cancelled, setCancelled] = useState(0)
  useEffect(() => {
    if (cancelled > 0) onReset?.()
    // Only on a new press: onReset is usually an inline function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelled])
  return (
    <>
      <Button
        type="button"
        variant="outline"
        aria-disabled={cancelInactive || undefined}
        onClick={ignoreWhenInactive(cancelInactive, () => {
          onCancel()
          setCancelled((n) => n + 1)
        })}
        className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
      >
        {t('common.cancel')}
      </Button>
      <SaveButton pending={pending} disabled={!dirty} label={submitLabel} pendingLabel={pendingLabel} />
    </>
  )
}

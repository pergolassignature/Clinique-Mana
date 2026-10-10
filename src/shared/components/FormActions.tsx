import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from 'react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { SaveButton } from './SaveButton'
import { ignoreWhenInactive, softDisabledClasses } from './soft-disabled'

interface FormActionsProps {
  /**
   * Puts the form back to its last saved values (e.g. react-hook-form's `reset()`); with
   * `cancelCloses`, closes the form instead (back to the display it was opened from).
   */
  onCancel: () => void
  /**
   * Runs once the form has re-rendered after `onCancel`, e.g. `() => form.setFocus('firstField')`
   * to send keyboard focus back to the form (react-hook-form's reset() re-registers the fields on
   * that render, so focusing earlier would miss them). Without it, focus stays on « Annuler ».
   * Not called with `cancelCloses`: the form closes, so the caller moves focus itself.
   */
  onReset?: () => void
  /** The form has unsaved changes: both buttons are active only then. */
  dirty: boolean
  /** A save is in flight: both buttons are inactive, the submit button says so. */
  pending?: boolean
  /** Another verb for the submit button (see SaveButton); « Enregistrer » by default. */
  submitLabel?: string
  pendingLabel?: string
  /**
   * « Annuler » closes the form instead of discarding edits (an edit mode opened by « Modifier »,
   * as in Coordonnées bancaires): it stays active while the form is clean, inactive only while saving.
   */
  cancelCloses?: boolean
}

/**
 * Where focus goes when the buttons it was on disappear (the form became clean): the form's title
 * (`aria-labelledby`, made a focus target that is never a tab stop), else its first field.
 */
function focusFormStart(form: HTMLFormElement) {
  const titleId = form.getAttribute('aria-labelledby')
  const title = titleId ? document.getElementById(titleId) : null
  if (title) {
    if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1')
    title.focus()
    return
  }
  form.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button')?.focus()
}

/**
 * The footer of a SettingsCard form: « Annuler / Enregistrer », aligned right by the card. Not a
 * dialog footer: here « Annuler » means « discard my edits », whereas a dialog's « Annuler »
 * always closes. A form shown only while editing (`cancelCloses`) is the exception: there
 * « Annuler » also leaves the edit mode.
 *
 * **Hidden until dirty** (decision UI-2, revising #34): while the form has nothing to save and no
 * save is in flight, nothing is rendered, so a page of several sections shows buttons only on the
 * section being edited; the teal « Enregistrer » is then the screen's one coloured action. With
 * `cancelCloses` (an edit mode opened by « Modifier ») the buttons always show: « Annuler » is the
 * way out.
 *
 * While saving, both buttons are `aria-disabled` rather than `disabled`, so keyboard focus stays
 * on them; presses are ignored meanwhile. When they disappear with focus on them (after a save or
 * « Annuler »), focus moves to the form's title (or first field), never to the page's body;
 * `onReset` may then move it to a field. « Annuler » is a plain button: it never submits.
 */
export function FormActions({ onCancel, onReset, dirty, pending = false, submitLabel, pendingLabel, cancelCloses = false }: FormActionsProps) {
  const hidden = !dirty && !pending && !cancelCloses
  const cancelInactive = (!dirty && !cancelCloses) || pending
  // Counts the « Annuler » presses: each one runs onReset after the render it caused.
  const [cancelled, setCancelled] = useState(0)
  useEffect(() => {
    if (cancelled > 0) onReset?.()
    // Only on a new press: onReset is usually an inline function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelled])

  // The form whose buttons hold keyboard focus, so focus can be put back when they disappear.
  const focusedIn = useRef<HTMLFormElement | null>(null)
  const onFocus = (event: FocusEvent<HTMLSpanElement>) => (focusedIn.current = event.currentTarget.closest('form'))
  const onBlur = (event: FocusEvent<HTMLSpanElement>) => {
    // Focus moving elsewhere in the page; a blur caused by the buttons' removal has no target.
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) focusedIn.current = null
  }
  useLayoutEffect(() => {
    const form = focusedIn.current
    if (!hidden || !form) return
    focusedIn.current = null
    const active = document.activeElement
    if (form.isConnected && (!active || active === document.body)) focusFormStart(form)
  }, [hidden])

  // Nothing at all, so the footer row that holds it collapses (SettingsCard: `empty:hidden`).
  if (hidden) return null
  return (
    <span className="contents" onFocus={onFocus} onBlur={onBlur}>
      <Button
        type="button"
        variant="outline"
        aria-disabled={cancelInactive || undefined}
        onClick={ignoreWhenInactive(cancelInactive, () => {
          onCancel()
          if (!cancelCloses) setCancelled((n) => n + 1)
        })}
        className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
      >
        {t('common.cancel')}
      </Button>
      <SaveButton
        pending={pending}
        disabled={!dirty}
        variant={dirty || pending ? 'default' : 'outline'}
        label={submitLabel}
        pendingLabel={pendingLabel}
      />
    </span>
  )
}

import { useState } from 'react'

/** What the activation and deactivation dialogs take: the opener mounts one while it is open. */
export interface StatusDialogProps {
  /** Closes the dialog (the opener unmounts it). Never called while the change is saving. */
  onClose: () => void
  /** Where focus goes once the dialog has closed (`focusAfterClose`). */
  onCloseAutoFocus: (event: Event) => void
}

/**
 * `value` as it was when nothing was saving. A successful change writes the new status into the
 * cached record before the dialog closes: the dialog keeps showing what was confirmed (its title,
 * its button) instead of the new status for that moment. After a refusal (nothing saving), a
 * refetched record shows at once: the file became incomplete, or someone else changed the status.
 */
export function useSettled<T>(value: T, saving: boolean): T {
  const [settled, setSettled] = useState(value)
  if (!saving && settled !== value) setSettled(value)
  return saving ? settled : value
}

/**
 * Once a dialog has closed: focus the first candidate still on the page (the button that opened it,
 * then another action), else `fallback` (the record's heading). A status change can take the
 * opener away (« Activer » once active, the « … » menu once inactive).
 */
export function focusAfterClose(event: Event, candidates: readonly (HTMLElement | null)[], fallback: () => void): void {
  event.preventDefault()
  const target = candidates.find((element) => element?.isConnected)
  if (target) target.focus()
  else fallback()
}

/**
 * An open combobox list inside the modal: Échap closes it first. `cmdk`'s input (« Rechercher », the
 * time-zone picker) is excluded: it says `aria-expanded="true"` at all times because its list is the
 * whole dialog, so Échap there must close the dialog.
 */
const OPEN_COMBOBOX = '[role="combobox"][aria-expanded="true"]:not([cmdk-input])'

/**
 * Échap inside a modal (Dialog, AlertDialog, Sheet) while a combobox's list is open closes the list,
 * not the modal. Radix listens for Échap on the document in the capture phase, before the field's own
 * handler, so the field cannot stop it; the modal's `onEscapeKeyDown` ignores an Échap that comes from
 * an expanded combobox (`AddressAutocomplete`, P4-223). The field still sees the key (marked
 * `defaultPrevented`) and closes its list; the next Échap closes the modal.
 */
export function keepOpenForCombobox(onEscapeKeyDown?: (event: KeyboardEvent) => void) {
  return (event: KeyboardEvent) => {
    const target = event.target as Element | null
    if (target?.closest?.(OPEN_COMBOBOX)) event.preventDefault()
    onEscapeKeyDown?.(event)
  }
}

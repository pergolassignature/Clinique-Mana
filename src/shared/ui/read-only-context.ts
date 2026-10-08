import { createContext, useContext } from 'react'

/**
 * Whether the fields around are read-only (set by `SettingsCard` for a user without the edit
 * permission). Read-only, never disabled: the values stay focusable, copyable and at normal
 * contrast. Input, Select, Textarea and FormField default to it; an explicit `readOnly` prop wins.
 */
export const FieldsReadOnlyContext = createContext(false)

/** `readOnly` as given, else the surrounding context's. */
export function useFieldReadOnly(readOnly: boolean | undefined): boolean {
  const inherited = useContext(FieldsReadOnlyContext)
  return readOnly ?? inherited
}

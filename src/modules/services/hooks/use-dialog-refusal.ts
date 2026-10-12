import { useEffect, useState } from 'react'
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { rpcErrorHint } from '@/core/modules/errors'
import type { MutationFeedback } from './use-services'

/**
 * The routing of a refusal in the module's dialogs and sheet: under the field the database named in
 * its HINT (as the compensation dialogs of Professionnels), else above the buttons.
 */

/** A refusal the database tied to a field (its HINT), or none. */
export interface FieldRefusal {
  field: string
  message: string
}

/**
 * Where a dialog shows a refusal: under the field the database named in its HINT (never by its
 * wording, e.g. `effective_from`, `code`), else above the buttons. `clear` before each submit and
 * when the dialog closes. `fields` maps HINTs to the form's field names.
 */
export function useDialogRefusal(fields: Readonly<Record<string, string>>) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const [fieldRefusal, setFieldRefusal] = useState<FieldRefusal | null>(null)
  const feedback: MutationFeedback = {
    onErrorMessage: (message, error) => {
      const hint = rpcErrorHint(error)
      const field = hint === undefined ? undefined : fields[hint]
      if (field) setFieldRefusal({ field, message })
      else setRefusal(message)
    },
  }
  const clear = () => {
    setRefusal(null)
    setFieldRefusal(null)
  }
  return { refusal, fieldRefusal, feedback, clear }
}

/** Puts a field refusal under its field and focuses it (each refusal is a new object). */
export function useRefusalOnField<T extends FieldValues>(setError: UseFormSetError<T>, fieldRefusal: FieldRefusal | null) {
  useEffect(() => {
    if (fieldRefusal) setError(fieldRefusal.field as Path<T>, { message: fieldRefusal.message }, { shouldFocus: true })
  }, [setError, fieldRefusal])
}

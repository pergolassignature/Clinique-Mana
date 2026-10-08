import { useEffect, useState } from 'react'
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { rpcErrorHint } from '@/core/modules/errors'
import type { MutationFeedback } from '../../hooks/mutation-feedback'

/** A refusal the database tied to the start date (HINT `effective_from`, P4-150). */
export interface DateError {
  message: string
}

/**
 * Where a compensation dialog shows a refusal: under « À partir du » when its HINT says
 * `effective_from` (never by its wording), else above the buttons. `clear` before each submit and
 * when the dialog closes.
 */
export function useDialogRefusal() {
  const [refusal, setRefusal] = useState<string | null>(null)
  const [dateError, setDateError] = useState<DateError | null>(null)
  const feedback: MutationFeedback = {
    onErrorMessage: (message, error) => (rpcErrorHint(error) === 'effective_from' ? setDateError({ message }) : setRefusal(message)),
  }
  const clear = () => {
    setRefusal(null)
    setDateError(null)
  }
  return { refusal, dateError, feedback, clear }
}

/** Puts a date refusal under the form's date field and focuses it (each refusal is a new object). */
export function useDateErrorOnField<T extends FieldValues>(setError: UseFormSetError<T>, field: Path<T>, dateError: DateError | null) {
  useEffect(() => {
    if (dateError) setError(field, { message: dateError.message }, { shouldFocus: true })
  }, [setError, field, dateError])
}

import type { BaseSyntheticEvent } from 'react'
import { useForm, type FieldValues, type Path, type PathValue, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'

/**
 * How the form re-syncs when the stored values change underneath it (another card's save, a
 * refetch on window focus): the fields the user changed keep their value, the errors shown stay.
 */
const RESYNC_OPTIONS = { keepDirtyValues: true, keepErrors: true } as const

/**
 * A full reset (after a save, « Annuler »). `reset` merges its options over `resetOptions`
 * (react-hook-form 7.89), so every re-sync option is turned off explicitly; the mapped type makes
 * a new one a compile error here.
 */
const FULL_RESET: { [K in keyof typeof RESYNC_OPTIONS]: false } = { keepDirtyValues: false, keepErrors: false }

interface SettingsFormOptions<TIn extends FieldValues, TOut> {
  /** String form values in, the normalised output out. */
  schema: z.ZodType<TOut, TIn>
  /** The stored values, as form values; the form follows them (`values`) and « Annuler » goes back to them. */
  values: TIn
}

export interface SettingsForm<TIn extends FieldValues, TOut> {
  form: UseFormReturn<TIn, unknown, TOut>
  /** « Annuler »: a full reset to the stored values (clean, errors cleared). */
  cancel: () => void
  /**
   * The form's submit handler. `save` receives the validated output and `onSaved`, to call with
   * the saved values (as form values) once the save succeeded.
   */
  handleSave: (save: (data: TOut, onSaved: (saved: TIn) => void) => void) => (event?: BaseSyntheticEvent) => Promise<void>
}

/**
 * The form of one settings card (an organization card, « Nom affiché » in « Mon compte »): it
 * follows the stored values without losing an edit, and after a save is reset to the saved values,
 * so it is clean (and the unsaved-changes guard disarmed) even when the normalised values equal
 * what was stored. The fields stay editable while saving: a field typed into meanwhile (changed
 * since the snapshot taken on submit) is put back on top, dirty, so nothing typed is lost.
 *
 * Not for forms that clear on success by design (courriel, mot de passe).
 */
export function useSettingsForm<TIn extends FieldValues, TOut>({ schema, values }: SettingsFormOptions<TIn, TOut>): SettingsForm<TIn, TOut> {
  const form = useForm<TIn, unknown, TOut>({
    resolver: zodResolver(schema),
    values,
    resetOptions: RESYNC_OPTIONS,
  })

  const cancel = () => form.reset(values, FULL_RESET)

  const handleSave: SettingsForm<TIn, TOut>['handleSave'] = (save) =>
    form.handleSubmit((data) => {
      const submitted = form.getValues()
      save(data, (saved) => {
        const current = form.getValues()
        form.reset(saved, FULL_RESET)
        for (const key of Object.keys(current) as Path<TIn>[]) {
          const value = current[key as keyof TIn]
          if (!Object.is(value, submitted[key as keyof TIn])) {
            form.setValue(key, value as PathValue<TIn, Path<TIn>>, { shouldDirty: true })
          }
        }
      })
    })

  return { form, cancel, handleSave }
}

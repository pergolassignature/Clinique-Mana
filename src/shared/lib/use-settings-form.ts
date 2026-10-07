import type { BaseSyntheticEvent } from 'react'
import { useForm, type Path, type PathValue, type UseFormReturn } from 'react-hook-form'
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

/**
 * The form values of a settings card: flat form values only, since the re-apply after a save
 * compares top-level keys (a nested object or an array would be compared by reference).
 */
export type FlatFormValues = Record<string, string | number | boolean | null>

interface SettingsFormOptions<TIn extends FlatFormValues, TOut> {
  /** String form values in, the normalised output out. */
  schema: z.ZodType<TOut, TIn>
  /** The stored values, as form values; the form follows them (`values`), keeping the user's edits. */
  values: TIn
}

export interface SettingsForm<TIn extends FlatFormValues, TOut> {
  form: UseFormReturn<TIn, unknown, TOut>
  /**
   * « Annuler »: a full reset (clean, errors cleared) to the form's default values, i.e. the last
   * saved or synced values. After a save that is the saved row, even before `values` catches up
   * (e.g. a refetch that is late or failed).
   */
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
 * Flat form values only, since the re-apply compares top-level keys. Not for forms that clear on
 * success by design (courriel, mot de passe).
 */
export function useSettingsForm<TIn extends FlatFormValues, TOut>({ schema, values }: SettingsFormOptions<TIn, TOut>): SettingsForm<TIn, TOut> {
  const form = useForm<TIn, unknown, TOut>({
    resolver: zodResolver(schema),
    values,
    resetOptions: RESYNC_OPTIONS,
  })

  // defaultValues is the whole object last passed to reset() or `values`, typed as partial by react-hook-form.
  const cancel = () => form.reset(form.formState.defaultValues as TIn, FULL_RESET)

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

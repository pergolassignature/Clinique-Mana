import { useMemo, type ReactNode } from 'react'
import type { Path, UseFormReturn } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import type { z } from 'zod'
import { FormActions } from '@/shared/components/FormActions'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm, type FlatFormValues } from '@/shared/lib/use-settings-form'
import { toast } from '@/shared/ui/sonner'
import type { ProfessionalRecord } from '../../api/parse'
import { professionalKeys } from '../../hooks/keys'
import type { UseCardSave } from '../../hooks/use-card-saves'
import { useRecordData } from './record-context'

interface ProfessionalCardProps<TIn extends FlatFormValues, TOut> {
  title: string
  description?: string
  /** `section` inside a `SectionSurface` (the record's form tabs, audit 2026-10-09 §2.4); `card` alone. */
  layout?: 'card' | 'section'
  /** Without the card's edit permission: read-only fields, no Annuler / Enregistrer, guard never armed. */
  readOnly: boolean
  /** The card's schema (`schemas/`): string form values in, the normalised patch out. */
  schema: z.ZodType<TOut, TIn>
  /** The card's values from the record. Module level (stable); also used for the reset after a save. */
  toFormValues: (record: ProfessionalRecord) => TIn
  /** The card's first field, in reading order: « Annuler » returns keyboard focus to it. */
  firstField: Path<TIn>
  /** The card's mutation (`hooks/use-card-saves.ts`), module level. */
  useSave: UseCardSave<TOut>
  /** The field a refusal belongs under, from its HINT (never its wording); null → a toast. */
  errorField?: (error: unknown) => Path<TIn> | null
  children: (form: UseFormReturn<TIn, unknown, TOut>) => ReactNode
}

/**
 * One card of a record tab that edits some fields of the open professional (Portrait, Identité,
 * Coordonnées…), built like `OrganizationCard`: its own form (`useSettingsForm`: follows the record
 * without losing an edit, clean after a save), its own « Annuler / Enregistrer » (`FormActions`:
 * shown only while dirty, decision UI-2), saving only its own fields. Read-only, the fields stay focusable and the
 * tab shows the one notice.
 */
export function ProfessionalCard<TIn extends FlatFormValues, TOut>({
  title,
  description,
  layout = 'card',
  readOnly,
  schema,
  toFormValues,
  firstField,
  useSave,
  errorField,
  children,
}: ProfessionalCardProps<TIn, TOut>) {
  const { record } = useRecordData()
  const id = record.professional.id
  const queryClient = useQueryClient()
  const values = useMemo(() => toFormValues(record), [toFormValues, record])
  const { form, cancel, handleSave } = useSettingsForm({ schema, values })
  const { save, pending } = useSave(id, {
    onErrorMessage: (message, error) => {
      const field = errorField?.(error)
      if (field) form.setError(field, { message }, { shouldFocus: true })
      else toast.error(message)
    },
  })
  const { isDirty } = form.formState
  useUnsavedChanges(isDirty && !readOnly)

  // The mutation has written the change into the cached record and awaited its refetch: the form
  // is reset to what is stored now (normalised), even if the context has not re-rendered yet.
  const onSubmit = handleSave((data, onSaved) =>
    save(data, () => onSaved(toFormValues(queryClient.getQueryData<ProfessionalRecord | null>(professionalKeys.record(id)) ?? record))),
  )

  return (
    <SettingsCard
      layout={layout}
      title={title}
      description={description}
      dirty={isDirty}
      readOnly={readOnly}
      pending={pending}
      onSubmit={(event) => void onSubmit(event)}
      footer={<FormActions onCancel={cancel} onReset={() => form.setFocus(firstField)} dirty={isDirty} pending={pending} />}
    >
      {children(form)}
    </SettingsCard>
  )
}

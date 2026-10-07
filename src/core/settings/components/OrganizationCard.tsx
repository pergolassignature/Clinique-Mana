import { useMemo, type ReactNode } from 'react'
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form'
import type { z } from 'zod'
import type { Organization, OrganizationUpdate } from '@/core/settings/organization/api'
import { useUpdateOrganization } from '@/core/settings/organization/hooks'
import { useSettingsSection } from '@/core/settings/section-context'
import { FormActions } from '@/shared/components/FormActions'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'

interface OrganizationCardProps<TIn extends FieldValues, TOut extends OrganizationUpdate> {
  /** The loaded organization (`useOrganization().data`); the form re-syncs when it changes. */
  organization: Organization
  title: string
  description?: string
  /** The card's schema from `organization/schemas.ts`: string form values in, the normalised patch out. */
  schema: z.ZodType<TOut, TIn>
  /** The card's `to…FormValues` from `schemas.ts`; also used for the reset after a save. Keep it stable (module level). */
  toFormValues: (org: Organization) => TIn
  /** The card's first field, in reading order: « Annuler » returns keyboard focus to it. */
  firstField: Path<TIn>
  /** The toast after a save (« Identité enregistrée. »). */
  successMessage: string
  /** The fields, wired with `form.register` (or `Controller` for a Select) inside `FormField`s. */
  children: (form: UseFormReturn<TIn, unknown, TOut>) => ReactNode
}

/**
 * One settings card that edits some columns of the caller's organization (Identité légale,
 * Signataire, Région, Confidentialité…). Each card has its own form and saves only its own fields.
 *
 * - The form follows the organization (`useSettingsForm`): what the user is typing, and the errors
 *   shown, survive another card's save refreshing the organization.
 * - Read-only (from the section: the user lacks its edit permission): the fields are `readOnly`,
 *   there is no Annuler / Enregistrer, and the guard is never armed. The page shows the one notice.
 * - After a save, the form is reset to the saved row, so it is clean (and the guard disarmed) even
 *   when the normalised values equal what was stored. Fields typed into while the save was in
 *   flight are put back on top, dirty, so nothing typed is lost.
 * - « Annuler » puts the stored values back and returns focus to `firstField`.
 */
export function OrganizationCard<TIn extends FieldValues, TOut extends OrganizationUpdate>({
  organization,
  title,
  description,
  schema,
  toFormValues,
  firstField,
  successMessage,
  children,
}: OrganizationCardProps<TIn, TOut>) {
  const { readOnly } = useSettingsSection()
  const values = useMemo(() => toFormValues(organization), [toFormValues, organization])
  const { form, cancel, handleSave } = useSettingsForm({ schema, values })
  const mutation = useUpdateOrganization(successMessage)
  const { isDirty } = form.formState
  useUnsavedChanges(isDirty && !readOnly)

  // `mutate` with a per-call onSuccess (not `mutateAsync` inside handleSubmit): the hook's own
  // callbacks show the toasts, and a failed save never becomes an unhandled rejection.
  const onSubmit = handleSave((patch, onSaved) =>
    mutation.mutate({ id: organization.id, patch }, { onSuccess: (saved) => onSaved(toFormValues(saved)) }),
  )

  return (
    <SettingsCard
      title={title}
      description={description}
      readOnly={readOnly}
      pending={mutation.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={<FormActions onCancel={cancel} onReset={() => form.setFocus(firstField)} dirty={isDirty} pending={mutation.isPending} />}
    >
      {children(form)}
    </SettingsCard>
  )
}

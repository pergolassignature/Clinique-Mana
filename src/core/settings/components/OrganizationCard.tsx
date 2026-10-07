import { useMemo, type ReactNode } from 'react'
import { useForm, type FieldValues, type Path, type PathValue, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { z } from 'zod'
import { t } from '@/i18n'
import type { Organization, OrganizationUpdate } from '@/core/settings/organization/api'
import { useUpdateOrganization } from '@/core/settings/organization/hooks'
import { useSettingsSection } from '@/core/settings/section-context'
import { SaveButton } from '@/shared/components/SaveButton'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { Button } from '@/shared/ui/button'

interface OrganizationCardProps<TIn extends FieldValues, TOut extends OrganizationUpdate> {
  /** The loaded organization (`useOrganization().data`); the form re-syncs when it changes. */
  organization: Organization
  title: string
  description?: string
  /** The card's schema from `organization/schemas.ts`: string form values in, the normalised patch out. */
  schema: z.ZodType<TOut, TIn>
  /** The card's `to…FormValues` from `schemas.ts`; also used for the reset after a save. Keep it stable (module level). */
  toFormValues: (org: Organization) => TIn
  /** The toast after a save (« Identité enregistrée. »). */
  successMessage: string
  /** The fields, wired with `form.register` (or `Controller` for a Select) inside `FormField`s. */
  children: (form: UseFormReturn<TIn, unknown, TOut>) => ReactNode
}

/**
 * One settings card that edits some columns of the caller's organization (Identité légale,
 * Signataire, Région, Confidentialité…). Each card has its own form and saves only its own fields.
 *
 * - The form follows the organization through `values`; `RESYNC_OPTIONS` keep what the user is
 *   typing, and the errors shown, when another card's save refreshes the organization.
 * - Read-only (from the section: the user lacks its edit permission): the fields are `readOnly`,
 *   there is no Annuler / Enregistrer, and the guard is never armed. The page shows the one notice.
 * - After a save, the form is reset to the saved row, so it is clean (and the guard disarmed) even
 *   when the normalised values equal what was stored. Fields typed into while the save was in
 *   flight are put back on top, dirty, so nothing typed is lost.
 */
/**
 * How a card re-syncs when the organization changes underneath it (another card's save, a refetch):
 * the fields the user changed keep their value, and the errors shown stay shown.
 */
const RESYNC_OPTIONS = { keepDirtyValues: true, keepErrors: true } as const

/**
 * A full reset (after a save, « Annuler »). `reset` merges its options over `resetOptions`, so every
 * re-sync option is turned off explicitly; the mapped type makes a new one a compile error here.
 */
const FULL_RESET: { [K in keyof typeof RESYNC_OPTIONS]: false } = { keepDirtyValues: false, keepErrors: false }

export function OrganizationCard<TIn extends FieldValues, TOut extends OrganizationUpdate>({
  organization,
  title,
  description,
  schema,
  toFormValues,
  successMessage,
  children,
}: OrganizationCardProps<TIn, TOut>) {
  const { readOnly } = useSettingsSection()
  const values = useMemo(() => toFormValues(organization), [toFormValues, organization])
  const form = useForm<TIn, unknown, TOut>({
    resolver: zodResolver(schema),
    values,
    resetOptions: RESYNC_OPTIONS,
  })
  const mutation = useUpdateOrganization(successMessage)
  const { isDirty } = form.formState
  useUnsavedChanges(isDirty && !readOnly)

  const resetTo = (next: TIn) => form.reset(next, FULL_RESET)

  // `mutate` with a per-call onSuccess (not `mutateAsync` inside handleSubmit): the hook's own
  // callbacks show the toasts, and a failed save never becomes an unhandled rejection.
  const onSubmit = form.handleSubmit((patch) => {
    // The fields stay editable while saving: what is typed meanwhile must survive the reset.
    const submitted = form.getValues()
    mutation.mutate(
      { id: organization.id, patch },
      {
        onSuccess: (saved) => {
          const current = form.getValues()
          resetTo(toFormValues(saved))
          for (const key of Object.keys(current) as Path<TIn>[]) {
            const value = current[key as keyof TIn]
            if (!Object.is(value, submitted[key as keyof TIn])) {
              form.setValue(key, value as PathValue<TIn, Path<TIn>>, { shouldDirty: true })
            }
          }
        },
      },
    )
  })

  return (
    <SettingsCard
      title={title}
      description={description}
      readOnly={readOnly}
      pending={mutation.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={
        // TODO(merge): use shared FormActions (src/shared/components/FormActions.tsx, from the other lane).
        <>
          <Button type="button" variant="outline" disabled={!isDirty || mutation.isPending} onClick={() => resetTo(values)}>
            {t('common.cancel')}
          </Button>
          <SaveButton pending={mutation.isPending} disabled={!isDirty} />
        </>
      }
    >
      {children(form)}
    </SettingsCard>
  )
}

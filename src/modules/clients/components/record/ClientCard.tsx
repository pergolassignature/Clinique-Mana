import { useMemo, type ReactNode } from 'react'
import type { Path, UseFormReturn } from 'react-hook-form'
import { rpcErrorHint } from '@/core/modules/errors'
import { FormActions } from '@/shared/components/FormActions'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { useUpdateClient } from '../../hooks/use-clients'
import { clientCardSchema, clientFormValues, fieldOfHint, mergeClientFields, type ClientFieldKey, type ClientFieldOutput, type ClientFormValues } from '../../schemas/client'
import { useClientRecordData } from './record-context'

interface ClientCardProps {
  title: string
  description?: string
  /** The fields this card edits; the others are sent as stored (`update_client` replaces them all). */
  fields: readonly ClientFieldKey[]
  /** The card's first field: « Annuler » returns focus to it. */
  firstField: ClientFieldKey
  children: (form: UseFormReturn<ClientFormValues, unknown, ClientFieldOutput>) => ReactNode
}

/**
 * One card of « Informations » (as Professionnels' record cards): its own form following the
 * stored file without losing an edit (`useSettingsForm`), its own « Annuler / Enregistrer » shown
 * only while dirty (UI-2), saving its fields over the stored ones; a refusal shows under the field
 * its HINT names. Read-only (no clients.manage, or a merged or anonymised file): the fields stay
 * focusable, no buttons.
 */
export function ClientCard({ title, description, fields, firstField, children }: ClientCardProps) {
  const { summary, canEdit } = useClientRecordData()
  const client = summary.client
  const schema = useMemo(() => clientCardSchema(fields), [fields])
  const values = useMemo(() => clientFormValues(client), [client])
  const { form, cancel, handleSave } = useSettingsForm<ClientFormValues, ClientFieldOutput>({ schema, values })
  const update = useUpdateClient({
    onErrorMessage: (message, error) => {
      const field = fieldOfHint(rpcErrorHint(error))
      if (field && fields.includes(field)) form.setError(field as Path<ClientFormValues>, { message }, { shouldFocus: true })
      else form.setError('root', { message })
    },
  })
  const { isDirty } = form.formState
  useUnsavedChanges(isDirty && canEdit)

  const onSubmit = handleSave((output, onSaved) =>
    update.mutate({ id: client.id, fields: mergeClientFields(client, output) }, { onSuccess: () => onSaved(form.getValues()) }),
  )

  return (
    <SettingsCard
      layout="section"
      title={title}
      description={description}
      dirty={isDirty}
      readOnly={!canEdit}
      pending={update.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={canEdit ? <FormActions onCancel={cancel} onReset={() => form.setFocus(firstField)} dirty={isDirty} pending={update.isPending} /> : undefined}
    >
      {children(form)}
      {form.formState.errors.root?.message && (
        <p role="alert" className="text-sm text-destructive">
          {form.formState.errors.root.message}
        </p>
      )}
    </SettingsCard>
  )
}

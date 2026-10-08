import { useMemo } from 'react'
import { Controller } from 'react-hook-form'
import { t } from '@/i18n'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { FormActions } from '@/shared/components/FormActions'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { SwitchField } from '@/shared/components/SwitchField'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { FormField } from '@/shared/ui/form-field'
import { Textarea } from '@/shared/ui/textarea'
import type { ProfessionalRecord } from '../../api/parse'
import { useUpdateMatchingProfile } from '../../hooks/use-professional-mutations'
import { AVAILABILITY_PERIODS } from '../../lib/constants'
import { availabilitySchema, toAvailabilityFormValues } from '../../schemas/matching'

const A = 'modules.professionals.record.matching.availability'

interface AvailabilityCardProps {
  record: ProfessionalRecord
  /** Without `professionals.matching`: the values show, nothing can change, no footer. */
  readOnly: boolean
}

/**
 * « Disponibilités générales » (P4-4): the moments of the week, « Accepte de nouveaux clients »
 * and a note, saved together on the matching profile (column grants, `professionals.matching`).
 * The form follows the record without losing an edit (`useSettingsForm`); ticks change the form
 * only (decision #36), « Enregistrer » saves.
 */
export function AvailabilityCard({ record, readOnly }: AvailabilityCardProps) {
  const id = record.professional.id
  const values = useMemo(() => toAvailabilityFormValues(record.matchingProfile), [record.matchingProfile])
  const { form, cancel, handleSave } = useSettingsForm({ schema: availabilitySchema, values })
  const mutation = useUpdateMatchingProfile()
  const { isDirty, errors } = form.formState
  useUnsavedChanges(isDirty && !readOnly)

  const onSubmit = handleSave((patch, onSaved) =>
    mutation.mutate({ id, patch }, { onSuccess: () => onSaved(toAvailabilityFormValues({ ...record.matchingProfile, ...patch })) }),
  )

  return (
    <SettingsCard
      title={t(`${A}.title`)}
      description={t(`${A}.description`)}
      readOnly={readOnly}
      pending={mutation.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={<FormActions onCancel={cancel} onReset={() => form.setFocus('am')} dirty={isDirty} pending={mutation.isPending} />}
    >
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium text-foreground">{t(`${A}.periods`)}</legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {AVAILABILITY_PERIODS.map((period) => (
            <Controller
              key={period}
              control={form.control}
              name={period}
              render={({ field }) => (
                <CheckboxField
                  ref={field.ref}
                  label={t(`modules.professionals.periods.${period}`)}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  onBlur={field.onBlur}
                />
              )}
            />
          ))}
        </div>
      </fieldset>
      <Controller
        control={form.control}
        name="acceptingNewClients"
        render={({ field }) => (
          <SwitchField
            ref={field.ref}
            label={t(`${A}.accepting`)}
            help={t(`${A}.acceptingHelp`)}
            checked={field.value}
            onCheckedChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      <FormField label={t(`${A}.note`)} error={errors.note?.message}>
        {(control) => <Textarea {...control} {...form.register('note')} placeholder={t(`${A}.notePlaceholder`)} maxLength={500} rows={3} className="min-h-16" />}
      </FormField>
    </SettingsCard>
  )
}

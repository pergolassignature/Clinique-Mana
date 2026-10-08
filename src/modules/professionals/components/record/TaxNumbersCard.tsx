import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { FormActions } from '@/shared/components/FormActions'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatTaxNumber } from '@/shared/lib/format'
import { regroupOnBlur } from '@/shared/lib/regroup-on-blur'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import type { ProfessionalPrivate } from '../../api/private'
import { professionalKeys } from '../../hooks/keys'
import { useExpectedVersion, useSaveTaxNumbers, type Refusal } from '../../hooks/use-private'
import { taxNumbersSchema, toTaxNumbersFormValues } from '../../schemas/private'
import { RefusalAlert } from '../compensation/DatedRowParts'

const X = 'modules.professionals.record.compensation.taxNumbers'

/**
 * « Fiscalité » (`professionals.private`): NE, TPS, TVQ, saved alone with
 * `set_professional_tax_numbers` (an empty field clears its number) and the version the person
 * started from (P4-148). A stale refusal keeps what was typed, refetches the numbers and says so
 * above the buttons; the next save goes through.
 */
export function TaxNumbersCard({ professionalId, data }: { professionalId: string; data: ProfessionalPrivate }) {
  const queryClient = useQueryClient()
  const values = useMemo(() => toTaxNumbersFormValues(data), [data])
  const { form, cancel, handleSave } = useSettingsForm({ schema: taxNumbersSchema, values })
  const { isDirty, errors } = form.formState
  const version = useExpectedVersion(data.updatedAt, isDirty)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const save = useSaveTaxNumbers(professionalId, (next) => {
    if (next.stale) version.acceptLatest(next.refetched)
    setRefusal(next)
  })
  useUnsavedChanges(isDirty)

  const onSubmit = handleSave((input, onSaved) => {
    setRefusal(null)
    save.mutate(
      { input, expectedUpdatedAt: version.expected() },
      {
        onSuccess: (savedAt) => {
          version.saved(savedAt)
          const fresh = queryClient.getQueryData<ProfessionalPrivate>(professionalKeys.private(professionalId)) ?? data
          onSaved(toTaxNumbersFormValues(fresh))
        },
      },
    )
  })
  // 123456789rt0001 → 123456789 RT 0001 once the field is left; the schema compacts it on save.
  const grouped = (name: 'gstNumber' | 'qstNumber') => regroupOnBlur(form, name, (v) => formatTaxNumber(v.trim()))

  return (
    <SettingsCard
      title={t(`${X}.title`)}
      description={t(`${X}.description`)}
      pending={save.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={
        <FormActions
          onCancel={() => {
            cancel()
            setRefusal(null)
          }}
          onReset={() => form.setFocus('businessNumber')}
          dirty={isDirty}
          pending={save.isPending}
        />
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label={t(`${X}.businessNumber`)} help={t(`${X}.businessNumberHelp`)} error={errors.businessNumber?.message}>
          {(field) => <Input {...field} {...form.register('businessNumber')} inputMode="numeric" autoComplete="off" />}
        </FormField>
        <FormField label={t(`${X}.gst`)} help={t(`${X}.gstHelp`)} error={errors.gstNumber?.message}>
          {(field) => <Input {...field} {...form.register('gstNumber', grouped('gstNumber'))} autoComplete="off" autoCapitalize="characters" />}
        </FormField>
        <FormField label={t(`${X}.qst`)} help={t(`${X}.qstHelp`)} error={errors.qstNumber?.message}>
          {(field) => <Input {...field} {...form.register('qstNumber', grouped('qstNumber'))} autoComplete="off" autoCapitalize="characters" />}
        </FormField>
      </div>
      {refusal && <RefusalAlert message={refusal.message} detail={refusal.detail} />}
    </SettingsCard>
  )
}

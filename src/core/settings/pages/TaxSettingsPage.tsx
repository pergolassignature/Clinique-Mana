import type { FocusEvent } from 'react'
import { t } from '@/i18n'
import { taxNumbersSchema, toTaxNumbersFormValues } from '@/core/settings/organization/schemas'
import { formatTaxNumber } from '@/shared/lib/format'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { OrganizationCard } from '../components/OrganizationCard'
import { OrganizationSettingsPage } from '../components/OrganizationSettingsPage'
import { TaxRatesCard } from '../components/TaxRatesCard'

/**
 * Paramètres → Fiscalité: the clinic's GST and QST registration numbers (one form card), then the
 * dated rates of each tax (two cards that are not forms: a table, « Nouveau taux », « Supprimer »).
 */
export function TaxSettingsPage() {
  return (
    <OrganizationSettingsPage title={t('settings.sections.tax')} description={t('settings.tax.description')}>
      {(organization) => (
        <>
          <OrganizationCard
            organization={organization}
            title={t('settings.tax.numbers.title')}
            schema={taxNumbersSchema}
            toFormValues={toTaxNumbersFormValues}
            firstField="gst_number"
            successMessage={t('settings.tax.numbers.saved')}
          >
            {({ register, setValue, formState: { errors, isSubmitted } }) => {
              // 123456789rt0001 → 123456789 RT 0001 once the field is left; the schema compacts it on save.
              const regroupOnBlur = (name: 'gst_number' | 'qst_number') => ({
                onBlur: (event: FocusEvent<HTMLInputElement>) => {
                  const grouped = formatTaxNumber(event.target.value.trim())
                  if (grouped !== event.target.value) setValue(name, grouped, { shouldDirty: true, shouldValidate: isSubmitted })
                },
              })
              return (
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField label={t('settings.tax.fields.gst')} help={t('settings.tax.fields.gstHelp')} error={errors.gst_number?.message}>
                    {(field) => <Input {...field} {...register('gst_number', regroupOnBlur('gst_number'))} autoComplete="off" autoCapitalize="characters" />}
                  </FormField>
                  <FormField label={t('settings.tax.fields.qst')} help={t('settings.tax.fields.qstHelp')} error={errors.qst_number?.message}>
                    {(field) => <Input {...field} {...register('qst_number', regroupOnBlur('qst_number'))} autoComplete="off" autoCapitalize="characters" />}
                  </FormField>
                </div>
              )
            }}
          </OrganizationCard>
          <TaxRatesCard tax="gst" />
          <TaxRatesCard tax="qst" />
        </>
      )}
    </OrganizationSettingsPage>
  )
}

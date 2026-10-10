import { t } from '@/i18n'
import { taxNumbersSchema, toTaxNumbersFormValues } from '@/core/settings/organization/schemas'
import { formatTaxNumber } from '@/shared/lib/format'
import { regroupOnBlur } from '@/shared/lib/regroup-on-blur'
import { FormField, FormRow } from '@/shared/ui/form-field'
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
            {(form) => {
              const { register, formState: { errors } } = form
              // 123456789rt0001 → 123456789 RT 0001 once the field is left; the schema compacts it on save.
              const grouped = (name: 'gst_number' | 'qst_number') => regroupOnBlur(form, name, (v) => formatTaxNumber(v.trim()))
              return (
                <FormRow>
                  <FormField label={t('settings.tax.fields.gst')} width="md" help={t('settings.tax.fields.gstHelp')} error={errors.gst_number?.message}>
                    {(field) => <Input {...field} {...register('gst_number', grouped('gst_number'))} autoComplete="off" autoCapitalize="characters" />}
                  </FormField>
                  <FormField label={t('settings.tax.fields.qst')} width="md" help={t('settings.tax.fields.qstHelp')} error={errors.qst_number?.message}>
                    {(field) => <Input {...field} {...register('qst_number', grouped('qst_number'))} autoComplete="off" autoCapitalize="characters" />}
                  </FormField>
                </FormRow>
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

import { t } from '@/i18n'
import { signatorySchema, toSignatoryFormValues } from '@/core/settings/organization/schemas'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { OrganizationCard } from '../components/OrganizationCard'
import { OrganizationSettingsPage } from '../components/OrganizationSettingsPage'

/**
 * Paramètres → Signataire: who signs the contracts and receipts for the clinic. The signature
 * image comes with the contracts module; a note under the card says so.
 */
export function SignatorySettingsPage() {
  return (
    <OrganizationSettingsPage title={t('settings.sections.signatory')} description={t('settings.signatory.description')}>
      {(organization) => (
        <>
          <OrganizationCard
            organization={organization}
            title={t('settings.signatory.representative.title')}
            schema={signatorySchema}
            toFormValues={toSignatoryFormValues}
            firstField="signatory_name"
            successMessage={t('settings.signatory.representative.saved')}
          >
            {({ register, formState: { errors } }) => (
              <div className="grid gap-3 md:grid-cols-2">
                <FormField label={t('settings.signatory.fields.name')} error={errors.signatory_name?.message}>
                  {(field) => <Input {...field} {...register('signatory_name')} autoComplete="off" />}
                </FormField>
                <FormField label={t('settings.signatory.fields.title')} error={errors.signatory_title?.message}>
                  {(field) => (
                    <Input {...field} {...register('signatory_title')} placeholder={t('settings.signatory.fields.titlePlaceholder')} autoComplete="off" />
                  )}
                </FormField>
              </div>
            )}
          </OrganizationCard>
          <p className="text-xs text-muted-foreground">{t('settings.signatory.note')}</p>
        </>
      )}
    </OrganizationSettingsPage>
  )
}

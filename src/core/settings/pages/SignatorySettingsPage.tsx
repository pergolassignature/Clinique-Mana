import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { signatorySchema, toSignatoryFormValues } from '@/core/settings/organization/schemas'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { OrganizationCard } from '../components/OrganizationCard'
import { OrganizationSettingsPage } from '../components/OrganizationSettingsPage'
import { OrgAssetCard } from '../components/OrgAssetCard'

/**
 * Paramètres → Signataire: who signs the contracts and receipts for the clinic, with their email,
 * and the clinic's signature image. The image card shows only with settings.manage: its file is
 * readable with that permission only (`org_signature`), so others would get no preview.
 */
export function SignatorySettingsPage() {
  const canManage = useAccess().can('settings.manage')
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
                <div className="md:col-span-2">
                  <FormField label={t('settings.signatory.fields.email')} help={t('settings.signatory.fields.emailHelp')} error={errors.signatory_email?.message}>
                    {(field) => <Input {...field} {...register('signatory_email')} type="email" autoComplete="off" />}
                  </FormField>
                </div>
              </div>
            )}
          </OrganizationCard>
          {canManage && <OrgAssetCard organization={organization} kind="signature" />}
        </>
      )}
    </OrganizationSettingsPage>
  )
}

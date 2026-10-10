import { t } from '@/i18n'
import { privacyOfficerSchema, privacyPolicySchema, toPrivacyOfficerFormValues, toPrivacyPolicyFormValues } from '@/core/settings/organization/schemas'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { OrganizationCard } from '../components/OrganizationCard'
import { OrganizationSettingsPage } from '../components/OrganizationSettingsPage'


/**
 * Paramètres → Confidentialité (Loi 25): the person in charge of personal information, then the
 * privacy policy's address and how long administrative records are kept. One card each.
 */
export function PrivacySettingsPage() {
  return (
    <OrganizationSettingsPage title={t('settings.sections.privacy')} description={t('settings.privacy.description')}>
      {(organization) => (
        <>
          <OrganizationCard
            organization={organization}
            title={t('settings.privacy.officer.title')}
            description={t('settings.privacy.officer.description')}
            schema={privacyOfficerSchema}
            toFormValues={toPrivacyOfficerFormValues}
            firstField="privacy_officer_name"
            successMessage={t('settings.privacy.officer.saved')}
          >
            {({ register, formState: { errors } }) => (
              <>
                <FormField label={t('settings.privacy.fields.officerName')} width="md" error={errors.privacy_officer_name?.message}>
                  {(field) => <Input {...field} {...register('privacy_officer_name')} autoComplete="off" />}
                </FormField>
                <FormField label={t('settings.privacy.fields.officerEmail')} error={errors.privacy_officer_email?.message}>
                  {(field) => <Input {...field} {...register('privacy_officer_email')} type="email" autoComplete="off" />}
                </FormField>
              </>
            )}
          </OrganizationCard>

          <OrganizationCard
            organization={organization}
            title={t('settings.privacy.policy.title')}
            description={t('settings.privacy.policy.description')}
            schema={privacyPolicySchema}
            toFormValues={toPrivacyPolicyFormValues}
            firstField="privacy_policy_url"
            successMessage={t('settings.privacy.policy.saved')}
          >
            {({ register, formState: { errors } }) => (
              <>
                <FormField label={t('settings.privacy.fields.policyUrl')} error={errors.privacy_policy_url?.message}>
                  {(field) => <Input {...field} {...register('privacy_policy_url')} type="url" inputMode="url" placeholder="https://" autoComplete="off" />}
                </FormField>
                <FormField
                    label={t('settings.privacy.fields.retentionYears')}
                    help={t('settings.privacy.fields.retentionYearsHelp')}
                    error={errors.record_retention_years?.message}
                  >
                    {/* A text field with the numeric keyboard, not type="number": a number input empties
                        what it cannot parse, which the schema would save as « no value ». */}
                    {(field) => <Input {...field} {...register('record_retention_years')} inputMode="numeric" autoComplete="off" className="w-field-xs max-w-full tabular" />}
                </FormField>
              </>
            )}
          </OrganizationCard>
        </>
      )}
    </OrganizationSettingsPage>
  )
}

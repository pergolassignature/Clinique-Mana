import { Controller } from 'react-hook-form'
import { t } from '@/i18n'
import { PROVINCE_OPTIONS } from '@/core/settings/organization/provinces'
import {
  addressSchema,
  clinicSchema,
  contactSchema,
  toAddressFormValues,
  toClinicFormValues,
  toContactFormValues,
} from '@/core/settings/organization/schemas'
import { formatPhone, formatPostalCode, parsePhone } from '@/shared/lib/format'
import { regroupOnBlur } from '@/shared/lib/regroup-on-blur'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { OrganizationCard } from '../components/OrganizationCard'
import { OrgAssetCard } from '../components/OrgAssetCard'
import { OrganizationSettingsPage } from '../components/OrganizationSettingsPage'

/** Full width in the card's two-column grid (long values); the others share a row from `md` up. */
const WIDE = 'md:col-span-2'
const GRID = 'grid gap-3 md:grid-cols-2'

/** A valid number in the Québec format (418 907-9754); anything else as typed, for its error. */
function regroupPhone(value: string): string {
  const parsed = parsePhone(value)
  return parsed ? formatPhone(parsed) : value
}

/**
 * Paramètres → Identité légale: the clinic's name and legal identity, its head-office address, its
 * contact details and its logo, one card each. The reference page for the organization settings
 * pages.
 */
export function IdentitySettingsPage() {
  return (
    <OrganizationSettingsPage title={t('settings.sections.identity')} description={t('settings.identity.description')}>
      {(organization) => (
        <>
          <OrganizationCard
            organization={organization}
            title={t('settings.identity.clinic.title')}
            schema={clinicSchema}
            toFormValues={toClinicFormValues}
            firstField="name"
            successMessage={t('settings.identity.clinic.saved')}
          >
            {({ register, formState: { errors } }) => (
              <div className={GRID}>
                <div className={WIDE}>
                  <FormField label={t('settings.identity.fields.name')} help={t('settings.identity.fields.nameHelp')} required error={errors.name?.message}>
                    {(field) => <Input {...field} {...register('name')} autoComplete="organization" />}
                  </FormField>
                </div>
                <div className={WIDE}>
                  <FormField label={t('settings.identity.fields.legalName')} error={errors.legal_name?.message}>
                    {(field) => <Input {...field} {...register('legal_name')} autoComplete="off" />}
                  </FormField>
                </div>
                <FormField label={t('settings.identity.fields.neq')} help={t('settings.identity.fields.neqHelp')} error={errors.neq?.message}>
                  {(field) => <Input {...field} {...register('neq')} inputMode="numeric" autoComplete="off" />}
                </FormField>
              </div>
            )}
          </OrganizationCard>

          <OrganizationCard
            organization={organization}
            title={t('settings.identity.address.title')}
            schema={addressSchema}
            toFormValues={toAddressFormValues}
            firstField="address_line1"
            successMessage={t('settings.identity.address.saved')}
          >
            {(form) => {
              const { register, control, formState: { errors } } = form
              return (
                <div className={GRID}>
                  <div className={WIDE}>
                    <FormField label={t('settings.identity.fields.addressLine1')} error={errors.address_line1?.message}>
                      {(field) => <Input {...field} {...register('address_line1')} autoComplete="address-line1" />}
                    </FormField>
                  </div>
                  <FormField label={t('settings.identity.fields.addressLine2')} error={errors.address_line2?.message}>
                    {(field) => <Input {...field} {...register('address_line2')} autoComplete="address-line2" />}
                  </FormField>
                  <FormField label={t('settings.identity.fields.city')} error={errors.city?.message}>
                    {(field) => <Input {...field} {...register('city')} autoComplete="address-level2" />}
                  </FormField>
                  <FormField label={t('settings.identity.fields.province')} error={errors.province?.message}>
                    {(field) => (
                      // Controlled, so the read-only Select can show the chosen province's name. No default
                      // here: the database defaults to QC (…_core_org_province_default_qc.sql), so the form
                      // shows what is stored. Null (only after « Aucune ») shows the placeholder.
                      <Controller
                        control={control}
                        name="province"
                        render={({ field: province }) => (
                          <Select
                            {...field}
                            {...province}
                            placeholder={t('settings.identity.fields.provincePlaceholder')}
                            clearable
                            clearLabel={t('settings.identity.fields.provinceNone')}
                            autoComplete="address-level1"
                          >
                            {PROVINCE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {t(option.labelKey)}
                              </option>
                            ))}
                          </Select>
                        )}
                      />
                    )}
                  </FormField>
                  <FormField label={t('settings.identity.fields.postalCode')} error={errors.postal_code?.message}>
                    {(field) => (
                      <Input
                        {...field}
                        // h2x1y4 → H2X 1Y4 as soon as the field is left; the schema checks it on save.
                        {...register('postal_code', regroupOnBlur(form, 'postal_code', (v) => formatPostalCode(v.trim())))}
                        autoComplete="postal-code"
                        autoCapitalize="characters"
                      />
                    )}
                  </FormField>
                </div>
              )
            }}
          </OrganizationCard>

          <OrganizationCard
            organization={organization}
            title={t('settings.identity.contact.title')}
            schema={contactSchema}
            toFormValues={toContactFormValues}
            firstField="phone"
            successMessage={t('settings.identity.contact.saved')}
          >
            {(form) => {
              const { register, formState: { errors } } = form
              return (
                <div className={GRID}>
                  <FormField label={t('settings.identity.fields.phone')} error={errors.phone?.message}>
                    {(field) => (
                      <Input
                        {...field}
                        // 4189079754 → 418 907-9754 once left; an invalid number stays as typed for its error.
                        {...register('phone', regroupOnBlur(form, 'phone', regroupPhone))}
                        type="tel"
                        autoComplete="off"
                      />
                    )}
                  </FormField>
                  <FormField label={t('settings.identity.fields.email')} error={errors.email?.message}>
                    {(field) => <Input {...field} {...register('email')} type="email" autoComplete="off" />}
                  </FormField>
                  <div className={WIDE}>
                    <FormField label={t('settings.identity.fields.website')} error={errors.website?.message}>
                      {(field) => <Input {...field} {...register('website')} type="url" inputMode="url" placeholder="https://" autoComplete="off" />}
                    </FormField>
                  </div>
                </div>
              )
            }}
          </OrganizationCard>

          <OrgAssetCard organization={organization} kind="logo" />
        </>
      )}
    </OrganizationSettingsPage>
  )
}

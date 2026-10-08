import { useRef } from 'react'
import { Controller } from 'react-hook-form'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { addressAutofill } from '@/core/address/autofill'
import { AddressAutocomplete } from '@/core/address/components/AddressAutocomplete'
import { rpcErrorCode, rpcErrorHint } from '@/core/modules/errors'
import { PROVINCE_OPTIONS } from '@/core/settings/organization/provinces'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { formatPostalCode, regroupPhone } from '@/shared/lib/format'
import { regroupOnBlur } from '@/shared/lib/regroup-on-blur'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import type { ProfessionalRecord } from '../../../api/parse'
import { useSaveIvac, useSaveProfessionalFields } from '../../../hooks/use-card-saves'
import { GENDERS } from '../../../lib/constants'
import { genderLabel } from '../../../lib/display'
import { contactSchema, toContactFormValues } from '../../../schemas/contact'
import {
  experienceSchema,
  identitySchema,
  normalizeIvac,
  payerNumbersSchema,
  toExperienceFormValues,
  toIdentityFormValues,
  toPayerNumbersFormValues,
} from '../../../schemas/identity'
import { ChangeEmailDialog } from '../ChangeEmailDialog'
import { editingHelp } from '../editing-help'
import { ProfessionalCard } from '../ProfessionalCard'
import { ProfessionsEditor } from '../ProfessionsEditor'
import { useRecordData } from '../record-context'

const I = 'modules.professionals.record.identity'
/** Full width in the card's two-column grid; the other fields share a row from `md` up. */
const WIDE = 'md:col-span-2'
const GRID = 'grid gap-3 md:grid-cols-2'
/** The home address fields, for the Google suggestions' autofill (P4-222). */
const ADDRESS_FIELDS = { line1: 'addressLine1', line2: 'addressLine2', city: 'city', province: 'province', postalCode: 'postalCode' } as const

// Module level: ProfessionalCard memoises on them.
const toIdentity = (record: ProfessionalRecord) => toIdentityFormValues(record.professional)
const toContact = (record: ProfessionalRecord) => toContactFormValues(record.professional)
const toExperience = (record: ProfessionalRecord) => toExperienceFormValues(record.professional)
const toPayers = (record: ProfessionalRecord) => toPayerNumbersFormValues(record.payerNumbers)
/** `set_professional_payer_number` refusals carry HINT `ivac` (invalid, or used in the clinic). */
const ivacError = (error: unknown) => (rpcErrorCode(error) === 'P0001' && rpcErrorHint(error) === 'ivac' ? ('ivac' as const) : null)

/**
 * « Identité et permis » (design §5.3): Identité, Coordonnées (with the login email), Professions et
 * permis, Expérience, Numéros de payeurs; one card each, each saving its own fields. Editable with
 * `professionals.manage`; read-only otherwise, with one notice.
 */
export function IdentityTab() {
  const readOnly = !useAccess().can('professionals.manage')
  return (
    <div className="max-w-form space-y-4">
      {readOnly && <ReadOnlyNotice body={t(`${I}.readOnly`)} />}
      <ProfessionalCard
        title={t(`${I}.identity.title`)}
        readOnly={readOnly}
        schema={identitySchema}
        toFormValues={toIdentity}
        firstField="firstName"
        useSave={useSaveProfessionalFields}
      >
        {({ register, control, formState: { errors } }) => (
          <div className={GRID}>
            <FormField label={t(`${I}.identity.firstName`)} required error={errors.firstName?.message}>
              {(field) => <Input {...field} {...register('firstName')} autoComplete="off" />}
            </FormField>
            <FormField label={t(`${I}.identity.lastName`)} required error={errors.lastName?.message}>
              {(field) => <Input {...field} {...register('lastName')} autoComplete="off" />}
            </FormField>
            <FormField label={t(`${I}.identity.gender`)} help={editingHelp(readOnly, t(`${I}.identity.genderHelp`))} error={errors.gender?.message}>
              {(field) => (
                // Controlled, so the read-only Select shows the chosen label.
                <Controller
                  control={control}
                  name="gender"
                  render={({ field: gender }) => (
                    <Select {...field} {...gender} placeholder={t(`${I}.identity.genderNone`)} readOnlyEmptyLabel={t(`${I}.identity.genderNone`)} clearable>
                      {GENDERS.map((value) => (
                        <option key={value} value={value}>
                          {genderLabel(value)}
                        </option>
                      ))}
                    </Select>
                  )}
                />
              )}
            </FormField>
          </div>
        )}
      </ProfessionalCard>

      <ProfessionalCard
        title={t(`${I}.contact.title`)}
        readOnly={readOnly}
        schema={contactSchema}
        toFormValues={toContact}
        firstField="personalPhone"
        useSave={useSaveProfessionalFields}
      >
        {(form) => {
          const { register, control, formState: { errors } } = form
          return (
            <div className={GRID}>
              <div className={WIDE}>
                <LoginEmail readOnly={readOnly} />
              </div>
              <FormField label={t(`${I}.contact.personalPhone`)} error={errors.personalPhone?.message}>
                {(field) => <Input {...field} {...register('personalPhone', regroupOnBlur(form, 'personalPhone', regroupPhone))} type="tel" autoComplete="off" />}
              </FormField>
              <div className={WIDE}>
                <FormField label={t(`${I}.contact.addressLine1`)} error={errors.addressLine1?.message}>
                  {(field) => (
                    // Google suggestions with manual override (P4-220, replaces P4-12's manual-only entry).
                    // The browser's address autofill is off on every address field (P4-222).
                    <AddressAutocomplete
                      {...field}
                      {...register('addressLine1')}
                      autofill={addressAutofill(form, ADDRESS_FIELDS)}
                      placeholder={t('address.line1Placeholder')}
                    />
                  )}
                </FormField>
              </div>
              <FormField label={t(`${I}.contact.addressLine2`)} error={errors.addressLine2?.message}>
                {(field) => <Input {...field} {...register('addressLine2')} placeholder={t('address.line2Placeholder')} autoComplete="off" />}
              </FormField>
              <FormField label={t(`${I}.contact.city`)} error={errors.city?.message}>
                {(field) => <Input {...field} {...register('city')} autoComplete="off" />}
              </FormField>
              <FormField label={t(`${I}.contact.province`)} required error={errors.province?.message}>
                {(field) => (
                  <Controller
                    control={control}
                    name="province"
                    render={({ field: province }) => (
                      <Select {...field} {...province} autoComplete="off">
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
              <FormField label={t(`${I}.contact.postalCode`)} error={errors.postalCode?.message}>
                {(field) => (
                  <Input
                    {...field}
                    {...register('postalCode', regroupOnBlur(form, 'postalCode', (v) => formatPostalCode(v.trim())))}
                    autoComplete="off"
                    autoCapitalize="characters"
                  />
                )}
              </FormField>
            </div>
          )
        }}
      </ProfessionalCard>

      <ProfessionsEditor readOnly={readOnly} />

      <ProfessionalCard
        title={t(`${I}.experience.title`)}
        readOnly={readOnly}
        schema={experienceSchema}
        toFormValues={toExperience}
        firstField="yearsExperience"
        useSave={useSaveProfessionalFields}
      >
        {({ register, formState: { errors } }) => (
          <div className={GRID}>
            <FormField label={t(`${I}.experience.years`)} error={errors.yearsExperience?.message}>
              {(field) => <Input {...field} {...register('yearsExperience')} inputMode="numeric" autoComplete="off" className="tabular" />}
            </FormField>
          </div>
        )}
      </ProfessionalCard>

      <ProfessionalCard
        title={t(`${I}.payers.title`)}
        readOnly={readOnly}
        schema={payerNumbersSchema}
        toFormValues={toPayers}
        firstField="ivac"
        useSave={useSaveIvac}
        errorField={ivacError}
      >
        {(form) => {
          const { register, formState: { errors } } = form
          return (
            <div className={GRID}>
              <FormField label={t(`${I}.payers.ivac`)} help={editingHelp(readOnly, t(`${I}.payers.ivacHelp`))} error={errors.ivac?.message}>
                {(field) => (
                  <Input
                    {...field}
                    // Upper-case once left, as it is stored (unique whatever the case).
                    {...register('ivac', regroupOnBlur(form, 'ivac', normalizeIvac))}
                    autoComplete="off"
                    autoCapitalize="characters"
                    className="tabular"
                  />
                )}
              </FormField>
            </div>
          )
        }}
      </ProfessionalCard>
    </div>
  )
}

/**
 * « Courriel de connexion »: shown, never typed in the card. While no account exists, « Modifier »
 * opens its dialog; once the professional has an account, « Mon compte » owns it.
 */
function LoginEmail({ readOnly }: { readOnly: boolean }) {
  const { professional } = useRecordData().record
  const hasAccount = professional.profileId !== null
  const input = useRef<HTMLInputElement | null>(null)
  return (
    <FormField label={t(`${I}.contact.loginEmail`)} readOnly help={editingHelp(readOnly, hasAccount ? t(`${I}.contact.accountOwns`) : undefined)}>
      {(field) => (
        <div className="flex min-w-0 items-center gap-2">
          <Input {...field} ref={input} value={professional.email} className="min-w-0 flex-1" />
          <ChangeEmailDialog professionalId={professional.id} email={professional.email} canChange={!readOnly && !hasAccount} fallbackFocus={input} />
        </div>
      )}
    </FormField>
  )
}

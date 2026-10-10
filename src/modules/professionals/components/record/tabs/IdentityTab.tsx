import { useRef, useState } from 'react'
import { Controller } from 'react-hook-form'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { addressAutofill } from '@/core/address/autofill'
import { AddressAutocomplete } from '@/core/address/components/AddressAutocomplete'
import { rpcErrorCode, rpcErrorHint } from '@/core/modules/errors'
import { PROVINCE_OPTIONS, provinceName } from '@/core/settings/organization/provinces'
import { DescriptionList, type DescriptionItem } from '@/shared/components/DescriptionList'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { formatPostalCode, regroupPhone } from '@/shared/lib/format'
import { regroupOnBlur } from '@/shared/lib/regroup-on-blur'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import type { ProfessionalRecord } from '../../../api/parse'
import { useSaveExperienceAndIvac, useSaveProfessionalFields } from '../../../hooks/use-card-saves'
import { GENDERS } from '../../../lib/constants'
import { genderLabel, professionLine } from '../../../lib/display'
import { contactSchema, toContactFormValues } from '../../../schemas/contact'
import {
  experienceAndPayersSchema,
  identitySchema,
  normalizeIvac,
  toExperienceFormValues,
  toIdentityFormValues,
  toPayerNumbersFormValues,
} from '../../../schemas/identity'
import { isLiveInvitation } from '../../../lib/onboarding'
import { ChangeEmailDialog } from '../ChangeEmailDialog'
import { editingHelp } from '../editing-help'
import { ProfessionalCard } from '../ProfessionalCard'
import { ProfessionsEditor } from '../ProfessionsEditor'
import { useRecordData } from '../record-context'

const I = 'modules.professionals.record.identity'
/** The home address fields, for the Google suggestions' autofill (P4-222). */
const ADDRESS_FIELDS = { line1: 'addressLine1', line2: 'addressLine2', city: 'city', province: 'province', postalCode: 'postalCode' } as const

// Module level: ProfessionalCard memoises on them.
const toIdentity = (record: ProfessionalRecord) => toIdentityFormValues(record.professional)
const toContact = (record: ProfessionalRecord) => toContactFormValues(record.professional)
const toExperienceAndPayers = (record: ProfessionalRecord) => ({
  ...toExperienceFormValues(record.professional),
  ...toPayerNumbersFormValues(record.payerNumbers),
})
/** `set_professional_payer_number` refusals carry HINT `ivac` (invalid, or used in the clinic). */
const ivacError = (error: unknown) => (rpcErrorCode(error) === 'P0001' && rpcErrorHint(error) === 'ivac' ? ('ivac' as const) : null)

/**
 * « Identité et permis » (design §5.3): Identité, Coordonnées (with the login email), Professions et
 * permis, Expérience et payeurs (decision UI-5: two small groups, one save); sections of one surface
 * (title and description in an aside from 720 px, audit 2026-10-09 §2.4), each saving its own
 * fields, fields sized to their content. Editable with `professionals.manage`. Whoever opens the tab
 * without it reads the same sections as description lists (decision UI-3), with one notice; a
 * permission lost while the tab is open turns the forms read-only in place (an open dialog stays).
 */
export function IdentityTab() {
  const readOnly = !useAccess().can('professionals.manage')
  // Chosen once: the tab never re-lays itself under the user (and its dialogs) when access changes.
  const [readerAtOpen] = useState(readOnly)
  if (readOnly && readerAtOpen) {
    return (
      <div className="space-y-5">
        <ReadOnlyNotice body={t(`${I}.readOnly`)} />
        <IdentityReadOnly />
      </div>
    )
  }
  return (
    <div className="space-y-5">
      {readOnly && <ReadOnlyNotice body={t(`${I}.readOnly`)} />}
      <SectionSurface>
      <ProfessionalCard
        layout="section"
        title={t(`${I}.identity.title`)}
        description={t(`${I}.identity.description`)}
        readOnly={readOnly}
        schema={identitySchema}
        toFormValues={toIdentity}
        firstField="firstName"
        useSave={useSaveProfessionalFields}
      >
        {({ register, control, formState: { errors } }) => (
          <>
            <FormRow>
              <FormField label={t(`${I}.identity.firstName`)} width="md" required error={errors.firstName?.message}>
                {(field) => <Input {...field} {...register('firstName')} autoComplete="off" />}
              </FormField>
              <FormField label={t(`${I}.identity.lastName`)} width="md" required error={errors.lastName?.message}>
                {(field) => <Input {...field} {...register('lastName')} autoComplete="off" />}
              </FormField>
            </FormRow>
            <FormField label={t(`${I}.identity.gender`)} help={editingHelp(readOnly, t(`${I}.identity.genderHelp`))} error={errors.gender?.message}>
              {(field) => (
                // Controlled, so the read-only Select shows the chosen label.
                <Controller
                  control={control}
                  name="gender"
                  render={({ field: gender }) => (
                    // The select at the width of a short choice; its help keeps the column's width.
                    <div className="w-field-md max-w-full">
                      <Select {...field} {...gender} placeholder={t(`${I}.identity.genderNone`)} readOnlyEmptyLabel={t(`${I}.identity.genderNone`)} clearable>
                        {GENDERS.map((value) => (
                          <option key={value} value={value}>
                            {genderLabel(value)}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
                />
              )}
            </FormField>
          </>
        )}
      </ProfessionalCard>

      <ProfessionalCard
        layout="section"
        title={t(`${I}.contact.title`)}
        description={t(`${I}.contact.description`)}
        readOnly={readOnly}
        schema={contactSchema}
        toFormValues={toContact}
        firstField="personalPhone"
        useSave={useSaveProfessionalFields}
      >
        {(form) => {
          const { register, control, formState: { errors } } = form
          return (
            <>
              <LoginEmail readOnly={readOnly} />
              <FormField label={t(`${I}.contact.personalPhone`)} width="md" error={errors.personalPhone?.message}>
                {(field) => <Input {...field} {...register('personalPhone', regroupOnBlur(form, 'personalPhone', regroupPhone))} type="tel" autoComplete="off" />}
              </FormField>
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
              <FormField label={t(`${I}.contact.addressLine2`)} width="md" error={errors.addressLine2?.message}>
                {(field) => <Input {...field} {...register('addressLine2')} placeholder={t('address.line2Placeholder')} autoComplete="off" />}
              </FormField>
              <FormRow>
              <FormField label={t(`${I}.contact.city`)} width="md" error={errors.city?.message}>
                {(field) => <Input {...field} {...register('city')} autoComplete="off" />}
              </FormField>
              {/* Province and code postal stay together: they wrap under Ville as a pair, never the code alone. */}
              <FormRow className="flex-nowrap">
              <FormField label={t(`${I}.contact.province`)} width="sm" required error={errors.province?.message}>
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
              <FormField label={t(`${I}.contact.postalCode`)} width="xs" error={errors.postalCode?.message}>
                {(field) => (
                  <Input
                    {...field}
                    {...register('postalCode', regroupOnBlur(form, 'postalCode', (v) => formatPostalCode(v.trim())))}
                    autoComplete="off"
                    autoCapitalize="characters"
                  />
                )}
              </FormField>
              </FormRow>
              </FormRow>
            </>
          )
        }}
      </ProfessionalCard>

      <ProfessionsEditor layout="section" readOnly={readOnly} />

      <ProfessionalCard
        layout="section"
        title={t(`${I}.experience.title`)}
        description={t(`${I}.experience.description`)}
        readOnly={readOnly}
        schema={experienceAndPayersSchema}
        toFormValues={toExperienceAndPayers}
        firstField="yearsExperience"
        useSave={useSaveExperienceAndIvac}
        errorField={ivacError}
      >
        {(form) => {
          const { register, formState: { errors } } = form
          return (
            <FormRow>
              <FormField label={t(`${I}.experience.years`)} width="sm" error={errors.yearsExperience?.message}>
                {(field) => <Input {...field} {...register('yearsExperience')} inputMode="numeric" autoComplete="off" className="tabular" />}
              </FormField>
              <FormField label={t(`${I}.payers.ivac`)} width="sm" help={editingHelp(readOnly, t(`${I}.payers.ivacHelp`))} error={errors.ivac?.message}>
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
            </FormRow>
          )
        }}
      </ProfessionalCard>
      </SectionSurface>
    </div>
  )
}

/** The tab for whoever can never edit it (UI-3): the same sections, as label and value. */
function IdentityReadOnly() {
  const { record, catalog } = useRecordData()
  const { professional, professions } = record
  const ivac = record.payerNumbers.find((p) => p.type === 'ivac')?.number ?? null
  const section = (title: string, description: string | undefined, items: DescriptionItem[]) => (
    <SettingsCard as="section" layout="section" title={title} description={description}>
      <DescriptionList items={items} />
    </SettingsCard>
  )
  return (
    <SectionSurface>
      {section(t(`${I}.identity.title`), t(`${I}.identity.description`), [
        { label: t(`${I}.identity.firstName`), value: professional.firstName },
        { label: t(`${I}.identity.lastName`), value: professional.lastName },
        { label: t(`${I}.identity.gender`), value: professional.gender && genderLabel(professional.gender) },
      ])}
      {section(t(`${I}.contact.title`), t(`${I}.contact.description`), [
        { label: t(`${I}.contact.loginEmail`), value: professional.email },
        { label: t(`${I}.contact.personalPhone`), value: professional.personalPhone },
        { label: t(`${I}.contact.addressLine1`), value: [professional.addressLine1, professional.addressLine2].filter(Boolean).join(', ') },
        { label: t(`${I}.contact.city`), value: professional.city },
        { label: t(`${I}.contact.province`), value: professional.province && provinceName(professional.province) },
        { label: t(`${I}.contact.postalCode`), value: professional.postalCode },
      ])}
      {section(
        t(`${I}.professions.title`),
        t(`${I}.professions.description`),
        professions.length === 0
          ? [{ label: t(`${I}.professions.titleField`), value: null, empty: t(`${I}.professions.empty`) }]
          : [...professions]
              .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
              .map((row) => ({
                key: row.id,
                label: row.isPrimary ? t(`${I}.professions.primary`) : t(`${I}.professions.titleField`),
                value: professionLine(row, catalog, professional.gender),
              })),
      )}
      {section(t(`${I}.experience.title`), t(`${I}.experience.description`), [
        { label: t(`${I}.experience.years`), value: professional.yearsExperience === null ? null : String(professional.yearsExperience) },
        { label: t(`${I}.payers.ivac`), value: ivac },
      ])}
    </SectionSurface>
  )
}

/**
 * « Courriel de connexion »: shown, never typed in the card. While no account exists, « Modifier »
 * opens its dialog; once the professional has an account, « Mon compte » owns it.
 */
function LoginEmail({ readOnly }: { readOnly: boolean }) {
  const { record, onboarding } = useRecordData()
  const { professional } = record
  const hasAccount = professional.profileId !== null
  const input = useRef<HTMLInputElement | null>(null)
  return (
    <FormField label={t(`${I}.contact.loginEmail`)} readOnly help={editingHelp(readOnly, hasAccount ? t(`${I}.contact.accountOwns`) : undefined)}>
      {(field) => (
        <div className="flex min-w-0 items-center gap-2">
          <Input {...field} ref={input} value={professional.email} className="min-w-0 flex-1" />
          <ChangeEmailDialog
            professionalId={professional.id}
            email={professional.email}
            canChange={!readOnly && !hasAccount}
            invitationLive={isLiveInvitation(onboarding?.invitation)}
            fallbackFocus={input}
          />
        </div>
      )}
    </FormField>
  )
}

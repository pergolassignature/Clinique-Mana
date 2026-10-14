import { useState } from 'react'
import { useWatch, type UseFormReturn } from 'react-hook-form'
import { t } from '@/i18n'
import { addressAutofill } from '@/core/address/autofill'
import { AddressAutocomplete } from '@/core/address/components/AddressAutocomplete'
import { PROVINCE_OPTIONS } from '@/core/settings/organization/provinces'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { FormActions } from '@/shared/components/FormActions'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { formatPostalCode, regroupPhone } from '@/shared/lib/format'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Textarea } from '@/shared/ui/textarea'
import { useSetClientNotes, useSetClientTags } from '../../../hooks/use-clients'
import { LANGUAGES, RATE_VARIANTS, SEXES } from '../../../lib/constants'
import { choices, languageLabel, rateVariantLabel, sexLabel } from '../../../lib/display'
import type { ClientFieldKey, ClientFieldOutput, ClientFormValues } from '../../../schemas/client'
import { ReferrerField } from '../../picker/ReferrerField'
import { ClientCard } from '../ClientCard'
import { CheckField, CheckGroup, DateInputField, SelectField, TextField } from '../field-parts'
import { useClientRecordData } from '../record-context'

const I = 'modules.clients.record.information'
const F = 'modules.clients.fields'

const IDENTITY: readonly ClientFieldKey[] = ['firstName', 'lastName', 'birthFirstName', 'pronouns', 'sex', 'birthday', 'language']
const CONTACT: readonly ClientFieldKey[] = ['email', 'mobile', 'home', 'work', 'workExt', 'remindersBySms', 'remindersByEmail']
const ADDRESS: readonly ClientFieldKey[] = ['addressLine1', 'addressLine2', 'city', 'province', 'postalCode', 'country']
const FILE: readonly ClientFieldKey[] = ['referralSourceId', 'referredBy', 'referredByClientId', 'customField', 'primaryProfessionalId']
const BILLING: readonly ClientFieldKey[] = ['rateVariant', 'taxExempt', 'specialAgreement', 'sharedCustody', 'fileIncomplete', 'isBanned']
const ADDRESS_FIELDS = { line1: 'addressLine1', line2: 'addressLine2', city: 'city', province: 'province', postalCode: 'postalCode' } as const

/**
 * « Informations » (plan C3.4): the file in sections, each its own card with « Enregistrer »
 * (Identité, Coordonnées, Adresse, Dossier, Tarif et indicateurs), then the staff notes and the
 * tags. Read-only for a merged or anonymised file, or without clients.manage (one notice).
 */
export function InformationTab() {
  const { summary, reference, canEdit } = useClientRecordData()
  const abroad = summary.client.country !== 'CA'
  return (
    <div className="space-y-5">
      {!canEdit && <ReadOnlyNotice body={t(`${I}.readOnly`)} />}
      <SectionSurface>
        <ClientCard title={t(`${I}.identity`)} fields={IDENTITY} firstField="firstName">
          {(form) => (
            <>
              <FormRow columns={2}>
                <TextField form={form} name="firstName" label={t(`${F}.firstName`)} width="full" required />
                <TextField form={form} name="lastName" label={t(`${F}.lastName`)} width="full" required />
              </FormRow>
              <FormRow columns={2}>
                <TextField form={form} name="birthFirstName" label={t(`${F}.birthFirstName`)} width="full" />
                <TextField form={form} name="pronouns" label={t(`${F}.pronouns`)} width="full" help={t(`${F}.pronounsHelp`)} />
              </FormRow>
              <FormRow columns={3}>
                <DateInputField form={form} name="birthday" label={t(`${F}.birthday`)} width="full" />
                <SelectField form={form} name="sex" label={t(`${F}.sex`)} width="full" placeholder={t(`${F}.notSaid`)} options={SEXES.map((v) => ({ value: v, label: sexLabel(v) }))} />
                <SelectField form={form} name="language" label={t(`${F}.language`)} width="full" required options={LANGUAGES.map((v) => ({ value: v, label: languageLabel(v) }))} />
              </FormRow>
            </>
          )}
        </ClientCard>

        <ClientCard title={t(`${I}.contact`)} description={t(`${I}.contactHelp`)} fields={CONTACT} firstField="email">
          {(form) => (
            <>
              <TextField form={form} name="email" label={t(`${F}.email`)} width="full" type="email" />
              <FormRow columns={2}>
                <TextField form={form} name="mobile" label={t(`${F}.mobile`)} width="full" type="tel" regroup={regroupPhone} />
                <TextField form={form} name="home" label={t(`${F}.home`)} width="full" type="tel" regroup={regroupPhone} />
              </FormRow>
              <FormRow columns={2}>
                <TextField form={form} name="work" label={t(`${F}.work`)} width="full" type="tel" regroup={regroupPhone} />
                <TextField form={form} name="workExt" label={t(`${F}.workExt`)} width="xs" />
              </FormRow>
              <CheckGroup>
                <CheckField form={form} name="remindersBySms" label={t(`${F}.remindersBySms`)} />
                <CheckField form={form} name="remindersByEmail" label={t(`${F}.remindersByEmail`)} />
              </CheckGroup>
            </>
          )}
        </ClientCard>

        <ClientCard title={t(`${I}.address`)} fields={ADDRESS} firstField="addressLine1">
          {(form) => (
            <>
              <FormField label={t(`${F}.addressLine1`)} error={form.formState.errors.addressLine1?.message}>
                {(field) => (
                  <AddressAutocomplete {...field} {...form.register('addressLine1')} autofill={addressAutofill(form, ADDRESS_FIELDS)} placeholder={t('address.line1Placeholder')} />
                )}
              </FormField>
              {/* Alone in the first column, as Professionnels' address forms (P4-220). */}
              <FormRow columns={2}>
                <TextField form={form} name="addressLine2" label={t(`${F}.addressLine2`)} width="full" />
              </FormRow>
              <FormRow columns="address">
                <TextField form={form} name="city" label={t(`${F}.city`)} width="full" />
                {abroad ? (
                  <TextField form={form} name="province" label={t(`${F}.provinceAbroad`)} width="full" />
                ) : (
                  <SelectField
                    form={form}
                    name="province"
                    label={t(`${F}.province`)}
                    width="full"
                    placeholder={t(`${F}.notSaid`)}
                    options={PROVINCE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                  />
                )}
                <TextField form={form} name="postalCode" label={t(`${F}.postalCode`)} width="full" regroup={abroad ? undefined : (v) => formatPostalCode(v.trim())} />
              </FormRow>
            </>
          )}
        </ClientCard>

        <ClientCard title={t(`${I}.file`)} fields={FILE} firstField="primaryProfessionalId">
          {(form) => (
            <>
              <FormRow columns={2}>
                <SelectField
                  form={form}
                  name="primaryProfessionalId"
                  label={t(`${F}.primaryProfessional`)}
                  width="full"
                  placeholder={t(`${F}.none`)}
                  options={choices(reference.professionals, [summary.client.primaryProfessionalId])}
                />
                {/* A one-line label, so both selects stay on one line; the question is the help. */}
                <SelectField
                  form={form}
                  name="referralSourceId"
                  label={t(`${F}.referralSourceShort`)}
                  help={t(`${F}.referralSource`)}
                  width="full"
                  placeholder={t(`${F}.notSaid`)}
                  options={choices(reference.referralSources, [summary.client.referralSourceId])}
                />
              </FormRow>
              <ReferrerCardField form={form} />
              <TextField form={form} name="customField" label={t(`${F}.customField`)} width="full" />
            </>
          )}
        </ClientCard>

        <ClientCard title={t(`${I}.billing`)} description={t(`${I}.billingHelp`)} fields={BILLING} firstField="rateVariant">
          {(form) => (
            <>
              <FormRow columns={2}>
                <SelectField
                  form={form}
                  name="rateVariant"
                  label={t(`${F}.rateVariant`)}
                  width="full"
                  placeholder={t(`${F}.regularRate`)}
                  options={RATE_VARIANTS.map((v) => ({ value: v, label: rateVariantLabel(v) }))}
                />
              </FormRow>
              <CheckGroup>
                <CheckField form={form} name="taxExempt" label={t(`${F}.taxExempt`)} help={t(`${F}.taxExemptHelp`)} />
                <CheckField form={form} name="specialAgreement" label={t(`${F}.specialAgreement`)} help={t(`${F}.specialAgreementHelp`)} />
                <CheckField form={form} name="sharedCustody" label={t(`${F}.sharedCustody`)} help={t(`${F}.sharedCustodyHelp`)} />
                <CheckField form={form} name="fileIncomplete" label={t(`${F}.fileIncomplete`)} />
                <CheckField form={form} name="isBanned" label={t(`${F}.isBanned`)} />
              </CheckGroup>
            </>
          )}
        </ClientCard>

        <NotesCard />
        <TagsCard />
      </SectionSurface>
    </div>
  )
}

/** « Notes administratives » and the « Entente particulière »'s note: staff only, their own RPC. */
function NotesCard() {
  const { summary, canEdit } = useClientRecordData()
  const stored = { admin: summary.adminNotes ?? '', special: summary.specialAgreementNote ?? '' }
  const [admin, setAdmin] = useState(stored.admin)
  const [special, setSpecial] = useState(stored.special)
  const [base, setBase] = useState(stored)
  // Saved elsewhere (or by this card) while not being edited: follow the stored notes.
  const untouched = admin === base.admin && special === base.special
  const saved = admin.trim() === stored.admin && special.trim() === stored.special
  if ((base.admin !== stored.admin || base.special !== stored.special) && (untouched || saved)) {
    setBase(stored)
    setAdmin(stored.admin)
    setSpecial(stored.special)
  }
  const dirty = admin !== stored.admin || special !== stored.special
  useUnsavedChanges(dirty && canEdit)
  const save = useSetClientNotes()
  return (
    <SettingsCard
      layout="section"
      title={t(`${I}.notes`)}
      description={t(`${I}.notesHelp`)}
      dirty={dirty}
      readOnly={!canEdit}
      pending={save.isPending}
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate({ id: summary.client.id, adminNotes: admin.trim() || null, specialAgreementNote: special.trim() || null })
      }}
      footer={
        canEdit ? (
          <FormActions
            dirty={dirty}
            pending={save.isPending}
            onCancel={() => {
              setAdmin(stored.admin)
              setSpecial(stored.special)
            }}
          />
        ) : undefined
      }
    >
      <FormField label={t(`${F}.adminNotes`)} width="full">
        {(field) => <Textarea {...field} value={admin} onChange={(event) => setAdmin(event.target.value)} rows={4} maxLength={5000} />}
      </FormField>
      <FormField label={t(`${F}.specialAgreementNote`)} width="full">
        {(field) => <Textarea {...field} value={special} onChange={(event) => setSpecial(event.target.value)} rows={2} maxLength={1000} />}
      </FormField>
    </SettingsCard>
  )
}

/** « Étiquettes »: up to 5 of the clinic's list. */
function TagsCard() {
  const { summary, reference, canEdit } = useClientRecordData()
  const stored = summary.tags.map((tag) => tag.id).sort()
  const [chosen, setChosen] = useState<string[]>(stored)
  const [base, setBase] = useState(stored.join())
  // Saved elsewhere (or by this card) while not being edited: follow the stored tags.
  if (base !== stored.join() && ([...chosen].sort().join() === base || [...chosen].sort().join() === stored.join())) {
    setBase(stored.join())
    setChosen(stored)
  }
  const dirty = [...chosen].sort().join() !== stored.join()
  useUnsavedChanges(dirty && canEdit)
  const save = useSetClientTags()
  const options = choices(reference.tags, stored)
  if (options.length === 0) return null
  return (
    <SettingsCard
      layout="section"
      title={t(`${I}.tags`)}
      description={t(`${I}.tagsHelp`)}
      dirty={dirty}
      readOnly={!canEdit}
      pending={save.isPending}
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate({ clientId: summary.client.id, tagIds: chosen })
      }}
      footer={canEdit ? <FormActions dirty={dirty} pending={save.isPending} onCancel={() => setChosen(stored)} /> : undefined}
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {options.map((tag) => {
          const checked = chosen.includes(tag.value)
          return (
            <li key={tag.value}>
              <CheckboxField
                label={tag.label}
                checked={checked}
                onCheckedChange={(value) => {
                  if (value === true && !checked && chosen.length < 5) setChosen([...chosen, tag.value])
                  if (value !== true) setChosen(chosen.filter((id) => id !== tag.value))
                }}
              />
            </li>
          )
        })}
      </ul>
      {chosen.length >= 5 && <p className="text-xs text-muted-foreground">{t(`${I}.tagsMax`)}</p>}
    </SettingsCard>
  )
}

/**
 * « Référé par » in the « Dossier » card (CL-30): a file of the clinic or a typed name, sent
 * together (choosing one clears the other); the record names the stored file (`summary.referrer`).
 */
function ReferrerCardField({ form }: { form: UseFormReturn<ClientFormValues, unknown, ClientFieldOutput> }) {
  const { summary } = useClientRecordData()
  const [text, clientId] = useWatch({ control: form.control, name: ['referredBy', 'referredByClientId'] })
  const { errors } = form.formState
  return (
    <ReferrerField
      label={t(`${F}.referredBy`)}
      value={{ clientId, text }}
      onChange={(next) => {
        form.setValue('referredByClientId', next.clientId, { shouldDirty: true })
        form.setValue('referredBy', next.text, { shouldDirty: true, shouldValidate: errors.referredBy !== undefined })
      }}
      known={summary.referrer}
      excludeId={summary.client.id}
      error={errors.referredBy?.message ?? errors.referredByClientId?.message}
    />
  )
}

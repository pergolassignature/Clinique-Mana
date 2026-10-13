import { useState } from 'react'
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
import { languageLabel, rateVariantLabel, sexLabel } from '../../../lib/display'
import type { ClientFieldKey } from '../../../schemas/client'
import { ClientCard } from '../ClientCard'
import { CheckField, CheckGroup, SelectField, TextField } from '../field-parts'
import { useClientRecordData } from '../record-context'

const I = 'modules.clients.record.information'
const F = 'modules.clients.fields'

const IDENTITY: readonly ClientFieldKey[] = ['firstName', 'lastName', 'birthFirstName', 'pronouns', 'sex', 'birthday', 'language']
const CONTACT: readonly ClientFieldKey[] = ['email', 'mobile', 'home', 'work', 'workExt', 'remindersBySms', 'remindersByEmail']
const ADDRESS: readonly ClientFieldKey[] = ['addressLine1', 'addressLine2', 'city', 'province', 'postalCode', 'country']
const FILE: readonly ClientFieldKey[] = ['referralSourceId', 'referredBy', 'customField', 'primaryProfessionalId']
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
              <FormRow>
                <TextField form={form} name="firstName" label={t(`${F}.firstName`)} required />
                <TextField form={form} name="lastName" label={t(`${F}.lastName`)} required />
              </FormRow>
              <FormRow>
                <TextField form={form} name="birthFirstName" label={t(`${F}.birthFirstName`)} />
                <TextField form={form} name="pronouns" label={t(`${F}.pronouns`)} help={t(`${F}.pronounsHelp`)} />
              </FormRow>
              <FormRow>
                <TextField form={form} name="birthday" label={t(`${F}.birthday`)} width="sm" type="date" />
                <SelectField form={form} name="sex" label={t(`${F}.sex`)} width="sm" placeholder={t(`${F}.notSaid`)} options={SEXES.map((v) => ({ value: v, label: sexLabel(v) }))} />
                <SelectField form={form} name="language" label={t(`${F}.language`)} width="sm" required options={LANGUAGES.map((v) => ({ value: v, label: languageLabel(v) }))} />
              </FormRow>
            </>
          )}
        </ClientCard>

        <ClientCard title={t(`${I}.contact`)} description={t(`${I}.contactHelp`)} fields={CONTACT} firstField="email">
          {(form) => (
            <>
              <TextField form={form} name="email" label={t(`${F}.email`)} width="full" type="email" />
              <FormRow>
                <TextField form={form} name="mobile" label={t(`${F}.mobile`)} type="tel" regroup={regroupPhone} />
                <TextField form={form} name="home" label={t(`${F}.home`)} type="tel" regroup={regroupPhone} />
              </FormRow>
              <FormRow>
                <TextField form={form} name="work" label={t(`${F}.work`)} type="tel" regroup={regroupPhone} />
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
              <TextField form={form} name="addressLine2" label={t(`${F}.addressLine2`)} />
              <FormRow>
                <TextField form={form} name="city" label={t(`${F}.city`)} />
                {abroad ? (
                  <TextField form={form} name="province" label={t(`${F}.provinceAbroad`)} />
                ) : (
                  <SelectField
                    form={form}
                    name="province"
                    label={t(`${F}.province`)}
                    width="sm"
                    placeholder={t(`${F}.notSaid`)}
                    options={PROVINCE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                  />
                )}
                <TextField form={form} name="postalCode" label={t(`${F}.postalCode`)} width="sm" regroup={abroad ? undefined : (v) => formatPostalCode(v.trim())} />
              </FormRow>
            </>
          )}
        </ClientCard>

        <ClientCard title={t(`${I}.file`)} fields={FILE} firstField="primaryProfessionalId">
          {(form) => (
            <>
              <FormRow>
                <SelectField
                  form={form}
                  name="primaryProfessionalId"
                  label={t(`${F}.primaryProfessional`)}
                  placeholder={t(`${F}.none`)}
                  options={reference.professionals.map((p) => ({ value: p.id, label: p.name }))}
                />
                <SelectField
                  form={form}
                  name="referralSourceId"
                  label={t(`${F}.referralSource`)}
                  placeholder={t(`${F}.notSaid`)}
                  options={reference.referralSources.map((s) => ({ value: s.id, label: s.name }))}
                />
              </FormRow>
              <TextField form={form} name="referredBy" label={t(`${F}.referredBy`)} width="full" />
              <TextField form={form} name="customField" label={t(`${F}.customField`)} width="full" />
            </>
          )}
        </ClientCard>

        <ClientCard title={t(`${I}.billing`)} description={t(`${I}.billingHelp`)} fields={BILLING} firstField="rateVariant">
          {(form) => (
            <>
              <SelectField
                form={form}
                name="rateVariant"
                label={t(`${F}.rateVariant`)}
                placeholder={t(`${F}.regularRate`)}
                options={RATE_VARIANTS.map((v) => ({ value: v, label: rateVariantLabel(v) }))}
              />
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
  const dirty = [...chosen].sort().join() !== stored.join()
  useUnsavedChanges(dirty && canEdit)
  const save = useSetClientTags()
  if (reference.tags.length === 0 && summary.tags.length === 0) return null
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
        {reference.tags.map((tag) => {
          const checked = chosen.includes(tag.id)
          return (
            <li key={tag.id}>
              <CheckboxField
                label={tag.name}
                checked={checked}
                onCheckedChange={(value) => {
                  if (value === true && !checked && chosen.length < 5) setChosen([...chosen, tag.id])
                  if (value !== true) setChosen(chosen.filter((id) => id !== tag.id))
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

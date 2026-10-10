import { useId } from 'react'
import { Controller, useWatch } from 'react-hook-form'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { SETTINGS_BASE_PATH } from '@/core/settings/paths'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { cn } from '@/shared/lib/utils'
import { Checkbox } from '@/shared/ui/checkbox'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import { ReferenceListCard, type ReferenceColumn, type ReferenceFormProps } from '../../components/settings/ReferenceListCard'
import { ReferenceSettingsPage } from '../../components/settings/ReferenceSettingsPage'
import { ScheduledJobState } from '../../components/settings/ScheduledJobState'
import { DOCUMENT_EXPIRY_RULES, DOCUMENT_MIME_TYPES, PHOTO_MIME_TYPES } from '../../lib/constants'
import { megabytesLabel, mimeLabel, mimeListLabel, remindersLabel } from '../../lib/documents'

const R = 'modules.professionals.settings.requiredDocuments'

/** The job that marks expired documents and sends the insurance reminders (P4-509). */
export const INSURANCE_EXPIRY_JOB = 'professionals.insurance_expiry_notice'

const COLUMNS: ReferenceColumn<'document_types'>[] = [
  { id: 'required', header: t(`${R}.required`), cell: (row) => t(row.required ? `${R}.yes` : `${R}.no`) },
  {
    id: 'expiry',
    header: t(`${R}.expiry`),
    // The image consent never expires (P4-504): said as such, not as a rule left at « Aucune ».
    cell: (row) => (row.key === 'image_consent' ? t(`${R}.consentNoExpiry`) : t(`${R}.rules.${row.expiryRule}`)),
    className: 'max-sm:hidden',
  },
  {
    id: 'reminders',
    header: t(`${R}.reminders`),
    cell: (row) => <span className={cn(row.reminderDays.length === 0 && !row.weeklyAfterExpiry && 'text-muted-foreground')}>{remindersLabel(row)}</span>,
    className: 'max-sm:hidden',
  },
  {
    id: 'files',
    header: t(`${R}.files`),
    // Every type the purposes accept reads « Tous les types », not six names.
    cell: (row) =>
      t(`${R}.filesSummary`, {
        types: row.acceptedMime.length === DOCUMENT_MIME_TYPES.length ? t(`${R}.allFiles`) : mimeListLabel(row.acceptedMime),
        size: megabytesLabel(row.maxBytes),
      }),
    className: 'max-md:hidden',
  },
]

/** The sizes offered (bytes); a row's own size, if another, is offered too. */
const SIZES = [1_048_576, 2_097_152, 5_242_880, 10_485_760]

/**
 * A document type's fields after « Nom »: « Requis », « Échéance » (none, the next March 31, 12
 * months), the insurance's reminders (P4-402: the days before, and weekly after; other types get
 * a line saying so), the accepted files (the photo: JPEG or PNG only) and the size cap. The
 * schema (`documentTypeSchema`) and `save_document_type` check them again.
 */
function DocumentTypeFields({ form, row }: ReferenceFormProps<'document_types'>) {
  const { errors } = form.formState
  const groupId = useId()
  const insurance = row?.key === 'insurance'
  const photo = row?.key === 'photo'
  const consent = row?.key === 'image_consent'
  const maxBytes = useWatch({ control: form.control, name: 'maxBytes' })
  const sizes = SIZES.includes(Number(maxBytes)) || maxBytes === '' ? SIZES : [...SIZES, Number(maxBytes)].sort((a, b) => a - b)
  return (
    <div className="grid gap-3.5">
      <Controller
        control={form.control}
        name="required"
        render={({ field, fieldState }) => (
          <CheckboxField
            ref={field.ref}
            label={t(`${R}.required`)}
            help={t(`${R}.requiredHelp`)}
            error={fieldState.error?.message}
            checked={field.value}
            onCheckedChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      {consent ? (
        // The image consent never expires (P4-504; the database keeps its rule at `none`).
        <FormField label={t(`${R}.expiry`)} help={t(`${R}.consentNoExpiryHelp`)}>
          {(field) => <Input {...field} readOnly value={t(`${R}.consentNoExpiry`)} />}
        </FormField>
      ) : (
        <FormField label={t(`${R}.expiry`)} help={t(`${R}.expiryHelp`)} error={errors.expiryRule?.message}>
          {(field) => (
            <Select {...field} {...form.register('expiryRule')}>
              {DOCUMENT_EXPIRY_RULES.map((rule) => (
                <option key={rule} value={rule}>
                  {t(`${R}.ruleOptions.${rule}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      )}
      {insurance ? (
        <>
          <FormField label={t(`${R}.reminderDays`)} help={t(`${R}.reminderDaysHelp`)} error={errors.reminderDays?.message}>
            {(field) => <Input {...field} {...form.register('reminderDays')} autoComplete="off" inputMode="numeric" maxLength={20} className="max-w-[160px] tabular" />}
          </FormField>
          <Controller
            control={form.control}
            name="weeklyAfterExpiry"
            render={({ field, fieldState }) => (
              <CheckboxField
                ref={field.ref}
                label={t(`${R}.weekly`)}
                help={t(`${R}.weeklyHelp`)}
                error={fieldState.error?.message}
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t(`${R}.remindersOnlyInsurance`)}</p>
      )}
      <Controller
        control={form.control}
        name="acceptedMime"
        render={({ field, fieldState }) => (
          <fieldset aria-describedby={fieldState.error ? `${groupId}-error` : photo ? `${groupId}-help` : undefined} className="space-y-1.5">
            <legend className="text-sm font-medium text-foreground">{t(`${R}.files`)}</legend>
            {photo && (
              <p id={`${groupId}-help`} className="text-xs text-muted-foreground">
                {t(`${R}.photoFilesHelp`)}
              </p>
            )}
            <div className="grid gap-1.5 sm:grid-cols-2">
              {DOCUMENT_MIME_TYPES.filter((mime) => !photo || PHOTO_MIME_TYPES.includes(mime) || field.value.includes(mime)).map((mime, index) => (
                <div key={mime} className="flex items-center gap-2">
                  <Checkbox
                    id={`${groupId}-${mime}`}
                    ref={index === 0 ? field.ref : undefined}
                    checked={field.value.includes(mime)}
                    aria-invalid={fieldState.error ? true : undefined}
                    onCheckedChange={(checked) => field.onChange(checked === true ? [...field.value, mime] : field.value.filter((m) => m !== mime))}
                    onBlur={field.onBlur}
                  />
                  <Label htmlFor={`${groupId}-${mime}`} className="font-normal">
                    {mimeLabel(mime)}
                  </Label>
                </div>
              ))}
            </div>
            {fieldState.error && (
              <p id={`${groupId}-error`} className="text-xs text-destructive">
                {fieldState.error.message}
              </p>
            )}
          </fieldset>
        )}
      />
      <FormField label={t(`${R}.maxBytes`)} error={errors.maxBytes?.message}>
        {(field) => (
          <Select {...field} {...form.register('maxBytes')} className="max-w-[160px]">
            {sizes.map((bytes) => (
              <option key={bytes} value={String(bytes)}>
                {megabytesLabel(bytes)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
    </div>
  )
}

/**
 * Paramètres → Documents requis (Task 4c.3): the document types a professional's file holds, in
 * the order the Documents tab shows them. A required type counts in readiness (« Documents requis
 * en règle »). The photo, the insurance and the image consent are followed by the application
 * (system rows): they can be made optional, never archived (P4-405). « Utilisé par » counts the
 * professionals holding a document of the type that was not refused (P4-453). Below the list: where
 * the image consent's text is edited (« Contrats et formulaires », P4-508), and whether the job
 * that sends the insurance reminders runs (« Échéances des assurances », P4-509).
 */
export function RequiredDocumentsSettingsPage() {
  return (
    <ReferenceSettingsPage title={t(`${R}.title`)} description={t(`${R}.description`)}>
      {({ catalog, usage, canEdit }) => (
        <>
          <ReferenceListCard
            kind="document_types"
            title={t(`${R}.title`)}
            headingHidden
            rows={catalog.documentTypes}
            usage={usage}
            columns={COLUMNS}
            renderForm={(props) => <DocumentTypeFields {...props} />}
            reorderable
            canEdit={canEdit}
            labels={{ add: t(`${R}.add`), createTitle: t(`${R}.createTitle`), editTitle: t(`${R}.editTitle`), systemNote: t(`${R}.system`) }}
          />
          <ConsentTextCard />
          <InsuranceJobCard />
        </>
      )}
    </ReferenceSettingsPage>
  )
}

/** The image consent's text is the Documenso template, edited in « Contrats et formulaires » (P4-508). */
function ConsentTextCard() {
  return (
    <SettingsCard as="section" title={t(`${R}.consentText.title`)} description={t(`${R}.consentText.body`)}>
      <GuardedNavLink to={`${SETTINGS_BASE_PATH}/contrats`} className="text-sm text-link underline-offset-[3px] hover:underline">
        {t(`${R}.consentText.open`)}
      </GuardedNavLink>
    </SettingsCard>
  )
}

/**
 * « Rappels d'assurance »: the reminders, the « Assurance expirée » notices and the missing
 * documents' count need the job « Échéances des assurances » (off by default): its state, as
 * « Invitations » says its own (P4-509).
 */
function InsuranceJobCard() {
  const { can } = useAccess()
  return (
    <SettingsCard as="section" title={t(`${R}.job.title`)} description={t(`${R}.job.description`)}>
      {can('settings.view') ? (
        <ScheduledJobState jobKey={INSURANCE_EXPIRY_JOB} texts={`${R}.job`} />
      ) : (
        <p className="text-sm text-muted-foreground">{t(`${R}.job.unknown`)}</p>
      )}
    </SettingsCard>
  )
}

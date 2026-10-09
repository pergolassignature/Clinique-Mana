import type { ReactNode } from 'react'
import { t } from '@/i18n'
import { PROVINCE_OPTIONS } from '@/core/settings/organization/provinces'
import { formatPhone, formatTaxNumber } from '@/shared/lib/format'
import { formatClinicDateTime, formatDateOnly } from '@/shared/lib/timezone'
import type { MySubmission, SectionValues } from '../../api/self'
import type { CatalogView } from '../../lib/catalog-view'
import { AVAILABILITY_PERIODS, type Gender } from '../../lib/constants'
import { clienteleLabel, minClientAgeLabel, periodsLabel, professionLine } from '../../lib/display'
import { held, starredFirst } from '../../lib/matching-digest'
import { summarizeMotifs } from '../../lib/motif-summary'
import type { SubmissionSection } from '../../lib/questionnaire'
import { submittedProfessions } from '../../schemas/questionnaire'
import { HeldChips } from '../record/Chips'
import { MotifsSummary } from '../record/MotifsSummary'
import { MyConsentSummary } from '../self/ConsentSigning'
import { OnFileError } from './StepParts'
import type { OnFilePrivate } from './use-step-form'

const L = 'modules.professionals.questionnaire'
const R = `${L}.review` as const

const provinceName = (code: string | null) => {
  const option = PROVINCE_OPTIONS.find((o) => o.value === code)
  return option ? t(option.labelKey) : code
}

const text = (values: SectionValues, key: string): string | null => {
  const value = values[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}
const ids = (values: SectionValues, key: string): string[] => {
  const value = values[key]
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

interface Row {
  label: string
  value: ReactNode
}

/** A label and its value, one per line on a phone, side by side from `sm`. Empty reads « Non indiqué ». */
function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 break-words text-foreground">{row.value ?? <span className="text-muted-foreground">{t(`${R}.notAnswered`)}</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

const yesNo = (value: boolean) => t(value ? `${R}.yes` : `${R}.no`)

/** The sections the record itself holds (no file, private value or signature): « Mon profil » shows them too. */
export const PROFILE_SECTIONS = ['personal', 'professional', 'portrait', 'languages', 'clienteles', 'motifs', 'availability'] as const
export type ProfileSection = (typeof PROFILE_SECTIONS)[number]
const isProfileSection = (section: SubmissionSection): section is ProfileSection => (PROFILE_SECTIONS as readonly string[]).includes(section)

interface ProfileSummaryProps {
  section: ProfileSection
  values: SectionValues
  catalog: CatalogView
  /** The professional's gender: the titles read in her form (P4-342). */
  gender: Gender | null
}

/**
 * A section the record holds, in words: ids named from the catalogue, motifs by category and by
 * name (P4-249), the titles in the professional's form. The questionnaire's summaries and
 * « Mon profil » (Task 4b.5) show the same words.
 */
export function ProfileSectionSummary({ section, values, catalog, gender }: ProfileSummaryProps) {
  switch (section) {
    case 'personal': {
      const province = text(values, 'province')
      const place = [text(values, 'city'), provinceName(province), text(values, 'postal_code')].filter(Boolean).join(', ')
      const street = [text(values, 'address_line1'), text(values, 'address_line2')].filter(Boolean).join(', ')
      return (
        <Rows
          rows={[
            { label: t(`${L}.personal.phone`), value: text(values, 'personal_phone') && formatPhone(text(values, 'personal_phone')) },
            { label: t(`${L}.personal.address`), value: street || place ? [street, place].filter(Boolean).join(', ') : null },
          ]}
        />
      )
    }
    case 'professional': {
      const professions = submittedProfessions(values)
      const years = values.years_experience
      return (
        <Rows
          rows={[
            {
              label: t(`${L}.professional.titles`),
              value:
                professions.length > 0 ? (
                  <ul>
                    {professions.map((p) => (
                      <li key={p.title_id}>
                        {professionLine({ titleId: p.title_id, licenceNumber: p.licence_number }, catalog, gender)}
                        {professions.length > 1 && p.is_primary && <span className="text-muted-foreground"> ({t(`${R}.primary`)})</span>}
                      </li>
                    ))}
                  </ul>
                ) : null,
            },
            { label: t(`${L}.professional.years`), value: typeof years === 'number' ? t(years <= 1 ? `${R}.year` : `${R}.years`, { count: String(years) }) : null },
          ]}
        />
      )
    }
    case 'portrait':
      return (
        <Rows
          rows={[
            { label: t(`${L}.portrait.bio`), value: text(values, 'bio') && <span className="line-clamp-4 whitespace-pre-line">{text(values, 'bio')}</span> },
            { label: t(`${L}.portrait.approach`), value: text(values, 'approach') && <span className="line-clamp-4 whitespace-pre-line">{text(values, 'approach')}</span> },
            { label: t(`${L}.portrait.publicEmail`), value: text(values, 'public_email') },
            { label: t(`${L}.portrait.publicPhone`), value: text(values, 'public_phone') && formatPhone(text(values, 'public_phone')) },
          ]}
        />
      )
    case 'languages':
      return <HeldChips items={held(catalog.languages, new Map(ids(values, 'language_ids').map((id) => [id, false])))} empty={t(`${L}.sets.languages.empty`)} />
    case 'clienteles': {
      const refs = Array.isArray(values.clienteles)
        ? values.clienteles.flatMap((r: unknown) => {
            const row = r as { id?: unknown; specialized?: unknown } | null
            return row && typeof row.id === 'string' ? [{ id: row.id, specialized: row.specialized === true }] : []
          })
        : []
      const age = values.min_client_age
      return (
        <div className="space-y-2">
          <HeldChips items={starredFirst(catalog.clienteles, refs, clienteleLabel)} empty={t(`${L}.sets.clienteles.empty`)} />
          {(typeof age === 'number' || values.women_only === true) && (
            <p className="text-sm text-muted-foreground">
              {[typeof age === 'number' ? minClientAgeLabel(age) : null, values.women_only === true ? t(`${L}.limits.womenOnly`) : null].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      )
    }
    case 'motifs': {
      const summary = summarizeMotifs(ids(values, 'motif_ids'), catalog)
      return summary.groups.length === 0 ? <p className="text-sm text-muted-foreground">{t(`${L}.sets.motifs.empty`)}</p> : <MotifsSummary summary={summary} />
    }
    case 'availability': {
      const periods = AVAILABILITY_PERIODS.filter((p) => ids(values, 'availability_periods').includes(p))
      return (
        <Rows
          rows={[
            { label: t(`${L}.availability.periods`), value: periods.length > 0 ? periodsLabel(periods) : null },
            { label: t(`${L}.availability.accepting`), value: yesNo(values.accepting_new_clients !== false) },
            { label: t(`${L}.availability.note`), value: text(values, 'availability_note') },
          ]}
        />
      )
    }
  }
}

interface SummaryProps {
  section: SubmissionSection
  values: SectionValues
  submission: MySubmission
  catalog: CatalogView
  onFile: OnFilePrivate
}

/**
 * One section's answers in words, as the review and the sent profile show them: what the section
 * holds now (prefill and answers); the record's sections as `ProfileSectionSummary` says them (the
 * titles in the provider's form, her gender, P4-367), private values as masks only (or why the
 * record's cannot be shown), dates in the clinic's time (date-only values as is); a signature of
 * an older text names its version.
 */
export function SectionSummary({ section, values, submission, catalog, onFile }: SummaryProps) {
  if (isProfileSection(section)) return <ProfileSectionSummary section={section} values={values} catalog={catalog} gender={submission.professional.gender} />
  const onFilePrivate = onFile.data
  switch (section) {
    case 'photo':
      return <p className="text-sm text-foreground">{text(values, 'file_id') ? t(`${L}.files.photoReceived`) : t(`${L}.files.photoNone`)}</p>
    case 'insurance': {
      const expiry = text(values, 'expires_on')
      return (
        <Rows
          rows={[
            { label: t(`${L}.files.insuranceProof`), value: text(values, 'file_id') ? t(`${L}.files.insuranceReceived`) : null },
            { label: t(`${L}.files.expiry`), value: expiry && formatDateOnly(expiry) },
          ]}
        />
      )
    }
    case 'tax_bank': {
      const saved = submission.private
      const plain = saved ?? onFilePrivate
      const account = saved?.bankAccountLast4 ?? (submission.onFile.hasBankAccount ? onFilePrivate?.bankAccountLast4 : null)
      const sin = saved?.sinLast3 ?? (submission.onFile.hasSin ? onFilePrivate?.sinLast3 : null)
      return (
        <div className="space-y-2">
          {onFile.failed && <OnFileError onFile={onFile} />}
          <Rows
          rows={[
            { label: t(`${L}.taxBank.institution`), value: plain?.bankInstitution ?? null },
            { label: t(`${L}.taxBank.transit`), value: plain?.bankTransit ?? null },
            { label: t(`${L}.taxBank.account`), value: account ? t(`${R}.masked4`, { last4: account }) : null },
            { label: t(`${L}.taxBank.businessNumber`), value: plain?.businessNumber ?? null },
            { label: t(`${L}.taxBank.gstNumber`), value: plain?.gstNumber ? formatTaxNumber(plain.gstNumber) : null },
            { label: t(`${L}.taxBank.qstNumber`), value: plain?.qstNumber ? formatTaxNumber(plain.qstNumber) : null },
            ...(submission.collectSin ? [{ label: t(`${L}.taxBank.sin`), value: sin ? t(`${R}.masked3`, { last3: sin }) : null }] : []),
          ]}
          />
        </div>
      )
    }
    case 'consent': {
      const signedId = text(values, 'consent_version_id')
      const current = submission.consent !== null && signedId === submission.consent.id
      const at = text(values, 'signed_at')
      const params = { date: at ? formatClinicDateTime(at) : '', name: text(values, 'signer_name') ?? '' }
      // Signed on an older text (the clinic published a newer one since): its version is named.
      const older = !current && signedId !== null && submission.signedConsentVersion !== null
      // Without the former e-consent: the consent signed through Documenso (P4-487).
      if (!current && !older) return <MyConsentSummary />
      return (
        <p className="text-sm text-foreground">
          {current ? t(`${L}.consent.signed`, params) : t(`${R}.signedVersion`, { ...params, version: String(submission.signedConsentVersion) })}
        </p>
      )
    }
  }
}

/**
 * The provider questionnaire's pure rules (4b.4), mirroring 20261008191219_professionals_onboarding.sql:
 * the eleven sections in their order (`private.submission_sections()`, no « Approches », P4-276),
 * the steps an update shows, what « Continuer » sends, and when a section is complete
 * (`private.submission_gaps`, P4-173). The database stays the authority: these rules only decide
 * what the questionnaire shows and sends before it asks.
 */

/** `private.submission_sections()`, in questionnaire order. */
export const SUBMISSION_SECTIONS = [
  'personal',
  'professional',
  'portrait',
  'languages',
  'clienteles',
  'motifs',
  'availability',
  'photo',
  'insurance',
  'tax_bank',
  'consent',
] as const
export type SubmissionSection = (typeof SUBMISSION_SECTIONS)[number]

/** A step: a requested section, or « Révision » (always last). */
export type QuestionnaireStep = SubmissionSection | 'review'

/** The URL segment of each step (`?etape=`): French, as the app's routes. */
export const STEP_SLUGS: Readonly<Record<QuestionnaireStep, string>> = {
  personal: 'renseignements-personnels',
  professional: 'profil-professionnel',
  portrait: 'portrait',
  languages: 'langues',
  clienteles: 'clienteles',
  motifs: 'motifs',
  availability: 'disponibilites',
  photo: 'photo',
  insurance: 'assurance',
  tax_bank: 'fiscalite-et-banque',
  consent: 'consentement',
  review: 'revision',
}

export const stepFromSlug = (slug: string | null, steps: readonly QuestionnaireStep[]): QuestionnaireStep | null =>
  steps.find((step) => STEP_SLUGS[step] === slug) ?? null

/** The steps of a submission: its requested sections in questionnaire order, then « Révision ». */
export function stepsFor(requested: readonly SubmissionSection[]): QuestionnaireStep[] {
  return [...SUBMISSION_SECTIONS.filter((section) => requested.includes(section)), 'review']
}

type Values = Readonly<Record<string, unknown>>
type SectionsValues = Readonly<Record<string, Values | undefined>>

/**
 * What a section shows: the prefill (the record when the submission was created), overlaid with
 * the answers saved since (a key once sent stays answered, P4-176).
 */
export function effectiveSection(prefill: SectionsValues, answered: SectionsValues, section: SubmissionSection): Values {
  return { ...(prefill[section] ?? {}), ...(answered[section] ?? {}) }
}

/** A deterministic JSON of a value (object keys sorted), to compare answers. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** Same answer (null and a missing value are the same). */
export const sameValue = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b)

/**
 * The fields of `parsed` (values as the database stores them) that differ from what the section
 * holds now, prefill included: what an autosave sends. Never the prefill as is (security review of
 * 4b.1: an untouched prefilled field sent would become « answered » and could overwrite a staff
 * change made meanwhile).
 */
export function changedFields(parsed: Values, current: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (!sameValue(value, current[key])) out[key] = value
  }
  return out
}

/**
 * The fields `submission_gaps` needs answered (P4-173), per section with a form. A file section
 * needs its file (and the insurance its expiry); availability needs only to be saved once.
 */
export const REQUIRED_FIELDS: Readonly<Partial<Record<SubmissionSection, readonly string[]>>> = {
  personal: ['personal_phone', 'address_line1', 'city', 'province', 'postal_code'],
  professional: ['professions'],
  portrait: ['bio'],
  languages: ['language_ids'],
  clienteles: ['clienteles'],
  motifs: ['motif_ids'],
  insurance: ['expires_on'],
}

const isAnswered = (answered: Values | undefined, key: string) => answered !== undefined && Object.hasOwn(answered, key)

/**
 * What « Continuer » sends for a section (P4-330): the changed fields, plus each required field
 * not answered yet with the value the step shows (the provider confirms it by continuing: the
 * completeness rule counts answers only). Availability is saved once even unchanged (`{}`), so the
 * step counts as seen. Null: nothing to send.
 */
export function confirmPayload(section: SubmissionSection, parsed: Values, prefill: Values | undefined, answered: Values | undefined): Record<string, unknown> | null {
  const out = changedFields(parsed, { ...(prefill ?? {}), ...(answered ?? {}) })
  for (const key of REQUIRED_FIELDS[section] ?? []) {
    if (!isAnswered(answered, key) && Object.hasOwn(parsed, key) && parsed[key] !== null) out[key] = parsed[key]
  }
  if (Object.keys(out).length > 0) return out
  return section === 'availability' && answered === undefined ? {} : null
}

// --- Completeness (private.submission_gaps, P4-173, P4-480) -------------------------------------

export interface CompletenessContext {
  /** The answers saved (submitted_values). */
  answered: SectionsValues
  /** The submission's private row (null when the private step was never saved, or purged). */
  privateRow: { bankInstitution: string | null; bankTransit: string | null; bankAccountLast4: string | null; sinLast3: string | null } | null
  /** The record's private data (`get_my_professional_private`), when read. */
  onFilePrivate: { bankInstitution: string | null; bankTransit: string | null } | null
  onFile: { hasSin: boolean; hasBankAccount: boolean }
  collectSin: boolean
  /** The latest published consent's id (null: none published). */
  consentId: string | null
  /**
   * The image consent through Documenso (`get_my_image_consent`, P4-487): whether the form is
   * published and the last day of a consent in force; null while not read.
   */
  imageConsent?: { available: boolean; validUntil: string | null } | null
  /** The clinic's today (`yyyy-MM-dd`). */
  today: string
}

const text = (values: Values | undefined, key: string): string | null => {
  const value = values?.[key]
  return typeof value === 'string' && value !== '' ? value : null
}
const listLength = (values: Values | undefined, key: string): number => {
  const value = values?.[key]
  return Array.isArray(value) ? value.length : 0
}

/** The staged file of a file section (photo, insurance), or null. */
export const sectionFileId = (answered: SectionsValues, section: 'photo' | 'insurance'): string | null => text(answered[section], 'file_id')

/** Whether a section is complete as the database checks it at « Envoyer » (files: their presence; the database also checks they are still staged). */
export function sectionComplete(section: SubmissionSection, ctx: CompletenessContext): boolean {
  const values = ctx.answered[section]
  switch (section) {
    case 'personal':
      return ['personal_phone', 'address_line1', 'city', 'province', 'postal_code'].every((key) => text(values, key) !== null)
    case 'professional':
      return listLength(values, 'professions') > 0
    case 'portrait':
      return text(values, 'bio') !== null
    case 'languages':
      return listLength(values, 'language_ids') > 0
    case 'clienteles':
      return listLength(values, 'clienteles') > 0
    case 'motifs':
      return listLength(values, 'motif_ids') > 0
    case 'availability':
      return values !== undefined
    case 'photo':
      return text(values, 'file_id') !== null
    case 'insurance': {
      const expiry = text(values, 'expires_on')
      return text(values, 'file_id') !== null && expiry !== null && expiry >= ctx.today
    }
    case 'tax_bank': {
      const row = ctx.privateRow
      if (!row) return false
      const institution = (row.bankInstitution ?? ctx.onFilePrivate?.bankInstitution ?? null) !== null
      const transit = (row.bankTransit ?? ctx.onFilePrivate?.bankTransit ?? null) !== null
      const account = row.bankAccountLast4 !== null || ctx.onFile.hasBankAccount
      const sin = !ctx.collectSin || row.sinLast3 !== null || ctx.onFile.hasSin
      // The deposit is optional, but whole or empty (P4-480).
      return institution === transit && transit === account && sin
    }
    case 'consent':
      // As private.submission_gaps (P4-487): a consent in force on the file (signed through
      // Documenso), the e-consent of a draft signed before the switch, or no form published yet.
      return (
        (ctx.consentId !== null && text(values, 'consent_version_id') === ctx.consentId) ||
        (ctx.imageConsent != null && (ctx.imageConsent.validUntil !== null || !ctx.imageConsent.available))
      )
  }
}

/** The requested sections not complete yet, in questionnaire order. */
export function incompleteSections(requested: readonly SubmissionSection[], ctx: CompletenessContext): SubmissionSection[] {
  return SUBMISSION_SECTIONS.filter((section) => requested.includes(section) && !sectionComplete(section, ctx))
}

/**
 * The requested sections that are not complete only because their prefill was never confirmed
 * (P4-330): what they show would be complete once « Continuer » sends it. « Révision » reads them
 * « À confirmer » rather than « À compléter ».
 */
export function sectionsToConfirm(requested: readonly SubmissionSection[], prefill: SectionsValues, ctx: CompletenessContext): SubmissionSection[] {
  const shown: Record<string, Values> = {}
  for (const section of SUBMISSION_SECTIONS) {
    if (prefill[section] !== undefined) shown[section] = effectiveSection(prefill, ctx.answered, section)
  }
  return incompleteSections(requested, ctx).filter((section) => prefill[section] !== undefined && sectionComplete(section, { ...ctx, answered: { ...ctx.answered, ...shown } }))
}

/** The section keys of a `sections` refusal (`professionals-submit`), known ones only, in order. */
export function sectionKeys(value: unknown): SubmissionSection[] {
  if (!Array.isArray(value)) return []
  return SUBMISSION_SECTIONS.filter((section) => value.includes(section))
}

// --- Insurance and consent --------------------------------------------------------------------

/**
 * The insurance's proposed expiry (the clinic's policies run April 1 – March 31; P4-412, decided
 * by Jonathan): uploaded in January or February, this year's March 31; from March 1 on, the
 * renewal for the period that starts next, so next year's March 31. `today` is the clinic date
 * (`yyyy-MM-dd`). The same rule as SQL `private.next_march_31`. The provider can change it.
 */
export function nextMarch31(today: string): string {
  const year = Number(today.slice(0, 4))
  return today < `${year}-03-01` ? `${year}-03-31` : `${year + 1}-03-31`
}

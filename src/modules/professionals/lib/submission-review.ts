import { t } from '@/i18n'
import { PROVINCE_OPTIONS } from '@/core/settings/organization/provinces'
import { formatPhone } from '@/shared/lib/format'
import type { StatusTone } from '@/shared/ui/status-dot'
import type { SpecializedRef } from '../api/parse'
import type { ReviewField, SubmissionReview, SubmissionRow } from '../api/submissions'
import { AVAILABILITY_PERIODS, SUBMISSION_FIELDS, type SubmissionField, type SubmissionKind, type SubmissionSection } from './constants'
import { minClientAgeLabel, periodsLabel } from './display'

/**
 * The review of a submission (Task 4b.5, A2.14–A2.16), pure: which fields changed (checked by
 * default), which did not (folded), what « Appliquer » sends, the sets as « ajoutés / retirés », and
 * every value in words (« il faut toujours être clair »: no raw id, no code, no symbol).
 */

const S = 'modules.professionals.submission'

/** A requested section as the sheet shows it: the changed fields first, the others folded under them. */
export interface SectionPlan {
  section: SubmissionSection
  changed: ReviewField[]
  /** Answered with the record's value, or never answered (the record keeps its value either way). */
  unchanged: ReviewField[]
}

/** The sections in the questionnaire's order, each split; a section without fields is left out. */
export function reviewPlan(review: Pick<SubmissionReview, 'sections'>): SectionPlan[] {
  return review.sections
    .filter((s) => s.fields.length > 0)
    .map((s) => ({ section: s.section, changed: s.fields.filter((f) => f.changed), unchanged: s.fields.filter((f) => !f.changed) }))
}

/** Every changed field, in the registry's order: what the sheet checks by default. */
export function changedFieldKeys(review: Pick<SubmissionReview, 'sections'>): SubmissionField[] {
  const changed = new Set(review.sections.flatMap((s) => s.fields.filter((f) => f.changed).map((f) => f.field)))
  return SUBMISSION_FIELDS.filter((field) => changed.has(field))
}

/**
 * What « Appliquer » sends: the checked fields among the changed ones, in the registry's order. An
 * unchanged field is never sent (applying it would write the value the record already holds).
 */
export function fieldsToApply(review: Pick<SubmissionReview, 'sections'>, checked: ReadonlySet<SubmissionField>): SubmissionField[] {
  return changedFieldKeys(review).filter((field) => checked.has(field))
}

/**
 * What « Appliquer » would refuse for a field, said on it before the click (P4-378; the database
 * still decides, P4-305): an insurance whose expiry is before the clinic's today, or a consent signed
 * on a text the clinic has replaced since (`is_latest` false). Null otherwise.
 */
export type FieldWarning = { kind: 'insurance_expired'; expiresOn: string } | { kind: 'consent_outdated' }

export function fieldWarning(field: Pick<ReviewField, 'field' | 'submitted'>, today: string): FieldWarning | null {
  const submitted = field.submitted as Record<string, unknown> | null
  if (field.field === 'insurance') {
    const expiresOn = submitted?.expires_on
    return typeof expiresOn === 'string' && expiresOn < today ? { kind: 'insurance_expired', expiresOn } : null
  }
  if (field.field === 'consent') return submitted?.is_latest === false ? { kind: 'consent_outdated' } : null
  return null
}

/** The French label of a field (`modules.professionals.submission.fields.<field>`, the payload's `label_key`). */
export function fieldLabel(field: SubmissionField): string {
  return t(`${S}.fields.${field}`)
}

// --- Sets ----------------------------------------------------------------------------------------

/** The sets the sheet says as « ajoutés / retirés » (the titles read side by side: two at most). */
export type SetField = 'language_ids' | 'clienteles' | 'motif_ids'
export const isSetDiffField = (field: SubmissionField): field is SetField => field === 'language_ids' || field === 'clienteles' || field === 'motif_ids'

/** Ids of a set value (`language_ids`, `motif_ids`); anything else is no id. */
export function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

export interface IdsDiff {
  added: string[]
  removed: string[]
  kept: string[]
}

/** What a set's answer adds and removes, against the record. */
export function idsDiff(current: unknown, submitted: unknown): IdsDiff {
  const before = new Set(idList(current))
  const after = new Set(idList(submitted))
  return {
    added: [...after].filter((id) => !before.has(id)),
    removed: [...before].filter((id) => !after.has(id)),
    kept: [...after].filter((id) => before.has(id)),
  }
}

/** The clientèles of a value (`[{id, specialized}]`); malformed rows are dropped. */
export function clienteleRefs(value: unknown): SpecializedRef[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row: unknown) => {
    const r = row as { id?: unknown; specialized?: unknown } | null
    return r && typeof r.id === 'string' ? [{ id: r.id, specialized: r.specialized === true }] : []
  })
}

export interface ClienteleDiff extends IdsDiff {
  /** Kept, and now ★ spécialisé. */
  starred: string[]
  /** Kept, and no longer ★. */
  unstarred: string[]
  /** The ★ of the answer, for the names added. */
  specialized: ReadonlySet<string>
}

/** The clientèles added and removed, and the ★ changed on the ones kept. */
export function clienteleDiff(current: unknown, submitted: unknown): ClienteleDiff {
  const before = new Map(clienteleRefs(current).map((r) => [r.id, r.specialized]))
  const after = clienteleRefs(submitted)
  const ids = idsDiff(
    [...before.keys()],
    after.map((r) => r.id),
  )
  const kept = after.filter((r) => before.has(r.id))
  return {
    ...ids,
    starred: kept.filter((r) => r.specialized && !before.get(r.id)).map((r) => r.id),
    unstarred: kept.filter((r) => !r.specialized && before.get(r.id)).map((r) => r.id),
    specialized: new Set(after.filter((r) => r.specialized).map((r) => r.id)),
  }
}

// --- Plain values in words -----------------------------------------------------------------------

const provinceName = (code: string) => {
  const option = PROVINCE_OPTIONS.find((o) => o.value === code)
  return option ? t(option.labelKey) : code
}

const yesNo = (value: boolean) => t(value ? `${S}.values.yes` : `${S}.values.no`)

/**
 * A plain field's value in words; null when empty (the sheet says « Non indiqué »). Phones are
 * grouped, the province named, booleans and the youngest client age said in full.
 */
export function plainValueText(field: SubmissionField, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  switch (field) {
    case 'personal_phone':
    case 'public_phone':
      return typeof value === 'string' ? formatPhone(value) : null
    case 'province':
      return typeof value === 'string' ? provinceName(value) : null
    case 'years_experience':
      return typeof value === 'number' ? t(value < 2 ? `${S}.values.year` : `${S}.values.years`, { count: String(value) }) : null
    case 'min_client_age':
      return typeof value === 'number' ? minClientAgeLabel(value) : null
    case 'women_only':
    case 'accepting_new_clients':
      return typeof value === 'boolean' ? yesNo(value) : null
    case 'availability_periods': {
      const periods = AVAILABILITY_PERIODS.filter((p) => idList(value).includes(p))
      return periods.length > 0 ? periodsLabel(periods) : null
    }
    default:
      return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null
  }
}

/** A long text (presentation, approach) keeps its paragraphs. */
export const isLongText = (field: SubmissionField) => field === 'bio' || field === 'approach' || field === 'availability_note'

// --- The file's submissions (« Questionnaire et mises à jour ») -----------------------------------

/** « Questionnaire d'accueil », « Mise à jour du profil ». */
export function submissionKindLabel(kind: SubmissionKind): string {
  return t(`${S}.kinds.${kind}`)
}

export type SubmissionState = 'returned' | 'in_progress' | 'to_review' | 'applied' | 'approved_unchanged' | 'cancelled'

const STATE_TONE: Readonly<Record<SubmissionState, StatusTone>> = {
  returned: 'neutral',
  in_progress: 'neutral',
  // The yellow of « À réviser » (P4-43): staff have something to do.
  to_review: 'warning',
  applied: 'success',
  approved_unchanged: 'success',
  cancelled: 'neutral',
}

/**
 * Where a submission stands, in words: a draft is with the professional (sent back when it carries
 * the reviewer's note: `returned`, since only reviewers read the note, P4-474), a sent one waits for the review, an approved one was applied (or approved
 * without a change), a cancelled one was closed without review (P4-301).
 */
export function submissionState(row: Pick<SubmissionRow, 'status' | 'returned' | 'appliedCount'>): SubmissionState {
  switch (row.status) {
    case 'draft':
      return row.returned ? 'returned' : 'in_progress'
    case 'submitted':
      return 'to_review'
    case 'approved':
      return row.appliedCount === 0 ? 'approved_unchanged' : 'applied'
    case 'cancelled':
      return 'cancelled'
  }
}

/** In agreement with the kind: « Appliqué » (le questionnaire), « Appliquée » (la mise à jour). */
export function submissionStateLabel(state: SubmissionState, kind: SubmissionKind): string {
  return t(`${S}.states.${kind}.${state}`)
}

export function submissionStateTone(state: SubmissionState): StatusTone {
  return STATE_TONE[state]
}

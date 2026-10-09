import { t } from '@/i18n'
import { formatMegabytes } from '@/shared/lib/files'
import { formatClinicDateShort, formatDateOnly, isCalendarDate, shiftCalendarDay } from '@/shared/lib/timezone'
import type { StatusTone } from '@/shared/ui/status-dot'
import type { ProfessionalConsent, ProfessionalDocument, ProfessionalDocuments, StagedDocument } from '../api/documents'
import type { DocumentType } from '../api/parse'
import type { DocumentExpiryRule, DocumentMimeType } from './constants'
import { listLabel } from './display'
import { nextMarch31 } from './questionnaire'

/**
 * The documents' states in plain words (Tasks 4c.3, 4c.6), shared by the Documents tab and « Mes
 * documents », so both say the same thing. Every date comparison uses the clinic's `today` from
 * `get_professional_documents` (a date-only `yyyy-MM-dd`), never the browser's clock; `expiresOn`
 * is the last valid day (P4-2): valid all of that day, expired the next.
 */

const D = 'modules.professionals.documents'

/** Whole days from `from` to `to` (date-only values; negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** `date` + 12 months, as SQL's `(date + interval '12 months')::date` (Feb 29 → Feb 28). */
export function addTwelveMonths(date: string): string {
  const year = Number(date.slice(0, 4)) + 1
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`
}

/**
 * The end date an upload is proposed with (editable), as SQL `private.document_default_expiry`:
 * the next March 31 (P4-412: January–February → this year's, from March 1 → next year's), the date
 * + 12 months, or none.
 */
export function defaultExpiry(rule: DocumentExpiryRule, today: string): string | null {
  if (rule === 'next_march_31') return nextMarch31(today)
  if (rule === 'months_12') return addTwelveMonths(today)
  return null
}

/** The largest reminder (days before the last valid day): the « bientôt échu » window; 0 without one. */
export const reminderWindow = (type: DocumentType) => Math.max(0, ...type.reminderDays)

/**
 * The last day an e-consent is in force: its own last day, or the day before its withdrawal takes
 * effect (as the readiness view, P4-405).
 */
export function consentLastDay(consent: ProfessionalConsent): string {
  if (!consent.withdrawalEffectiveOn) return consent.expiresOn
  const before = shiftCalendarDay(consent.withdrawalEffectiveOn, -1)
  return before < consent.expiresOn ? before : consent.expiresOn
}

/** `submitted`: nothing counts yet, but the questionnaire waiting for review holds it (P4-495). */
export type DocumentStateKind = 'valid' | 'expiring' | 'expired' | 'pending' | 'submitted' | 'rejected' | 'missing'

/** One type's documents, as a card shows them. */
export interface TypeDocuments {
  type: DocumentType
  kind: DocumentStateKind
  /** The verified (or expired) document that counts: for a type with a rule, the latest last day. */
  current: ProfessionalDocument | null
  /** The newest document waiting for a review, if any (a renewal while the current one is valid). */
  pending: ProfessionalDocument | null
  /** The newest document when it was refused (and nothing waits since). */
  rejected: ProfessionalDocument | null
  /** The image consent's e-consent while it is in force (it satisfies the type, P4-405). */
  consent: ProfessionalConsent | null
  /** The last valid day shown (the current document's, or the e-consent's), if any. */
  until: string | null
  /** The type's other documents (superseded, older refusals), newest first. */
  older: ProfessionalDocument[]
  /** What the open questionnaire holds for this type (a draft, or sent and waiting), if anything (P4-495). */
  staged: StagedDocument | null
}

/**
 * A verified document, unexpired on `today`. For a type with a rule a document without a date does
 * not count (its type got a rule after it was verified), as the readiness view's `max(expires_on)`.
 */
const isValid = (d: ProfessionalDocument, today: string, rule: DocumentExpiryRule = 'none') =>
  d.status === 'verified' && (d.expiresOn === null ? rule === 'none' : d.expiresOn >= today)

/**
 * The state of one type on the clinic's `today`: valid (or expiring within the type's largest
 * reminder), expired, pending (nothing valid yet, a document waits), refused (the newest one,
 * nothing waiting), missing. For the image consent, an e-consent in force counts as valid.
 */
export function typeDocuments(type: DocumentType, data: Pick<ProfessionalDocuments, 'documents' | 'consent' | 'today'> & Partial<Pick<ProfessionalDocuments, 'staged'>>): TypeDocuments {
  const { today } = data
  const docs = data.documents.filter((d) => d.typeId === type.id)
  const reviewed = docs.filter((d) => d.status === 'verified' || d.status === 'expired')
  // Newest first already: `reduce` keeps the first of equal dates.
  const current =
    type.expiryRule === 'none'
      ? (reviewed.find((d) => d.status === 'verified') ?? reviewed[0] ?? null)
      : reviewed.reduce<ProfessionalDocument | null>((best, d) => (best === null || (d.expiresOn ?? '') > (best.expiresOn ?? '') ? d : best), null)
  const pending = docs.find((d) => d.status === 'pending') ?? null
  const rejected = pending === null && docs[0]?.status === 'rejected' ? docs[0] : null
  // The payload holds the latest e-consent only (the view takes the latest valid one of all: the
  // same unless a newer one ends sooner, a case the questionnaire does not produce).
  const consent = type.key === 'image_consent' && data.consent && consentLastDay(data.consent) >= today ? data.consent : null
  const older = docs.filter((d) => d !== current && d !== pending && d !== rejected)
  const staged = data.staged?.find((x) => x.typeKey === type.key) ?? null

  let kind: DocumentStateKind
  let until: string | null = null
  if (current && isValid(current, today, type.expiryRule)) {
    // The image consent: the later of the document's last day and the e-consent's.
    const consentUntil = consent ? consentLastDay(consent) : null
    until = consentUntil !== null && current.expiresOn !== null && consentUntil > current.expiresOn ? consentUntil : current.expiresOn
    const window = reminderWindow(type)
    kind = until !== null && window > 0 && daysBetween(today, until) <= window ? 'expiring' : 'valid'
  } else if (consent) {
    kind = 'valid'
    until = consentLastDay(consent)
  } else if (current) {
    kind = 'expired'
    until = current.expiresOn
  } else if (pending) {
    kind = 'pending'
  } else if (rejected) {
    kind = 'rejected'
  } else {
    kind = 'missing'
  }
  // Sent with the questionnaire, waiting for review: never « Manquant » (nor « Refusé », « Expiré »).
  if (staged?.status === 'submitted' && (kind === 'missing' || kind === 'rejected' || kind === 'expired')) kind = 'submitted'
  return { type, kind, current, pending, rejected, consent, until, older, staged }
}

/**
 * The professional's own draft holds this type while nothing counts (P4-495): « Ajouté à votre
 * questionnaire, pas encore envoyé » on her side; staff read the card's own state (not sent yet).
 */
export const stagedInDraft = ({ kind, staged }: Pick<TypeDocuments, 'kind' | 'staged'>) =>
  staged?.status === 'draft' && (kind === 'missing' || kind === 'rejected' || kind === 'expired')

/**
 * Whether the card offers « Téléverser » / « Remplacer » (P4-495): never to the professional while
 * her open questionnaire holds the type (a second copy would bypass its review); staff keep it.
 */
export const uploadOffered = (entry: Pick<TypeDocuments, 'staged'>, viewer: DocumentViewer, can: Pick<DocumentPermissions, 'upload'>) =>
  can.upload && !(viewer === 'self' && entry.staged !== null)

/**
 * A type's state in words: « Valide jusqu'au 31 mars 2027 », « Vérifié », « Expire le … »,
 * « Expiré : valide jusqu'au … » (the last valid day, never « expiré le », a day off, P4-413).
 * `self`: the professional reads it (« En attente de vérification par la clinique », not « À vérifier »).
 */
export function typeStateLabel(entry: Pick<TypeDocuments, 'kind' | 'until'> & Partial<Pick<TypeDocuments, 'staged'>>, self = false): string {
  const { kind, until, staged = null } = entry
  const consent = staged?.kind === 'consent' ? 'Consent' : ''
  if (self && stagedInDraft({ kind, staged })) return t(`${D}.state.inDraftSelf${consent}`)
  switch (kind) {
    case 'valid':
      return until ? t(`${D}.state.validUntil`, { date: formatDateOnly(until) }) : t(`${D}.state.verified`)
    case 'expiring':
      return t(`${D}.state.expiring`, { date: formatDateOnly(until) })
    case 'expired':
      return until ? t(`${D}.state.expiredOn`, { date: formatDateOnly(until) }) : t(`${D}.state.expired`)
    case 'pending':
      return t(self ? `${D}.state.pendingSelf` : `${D}.state.pending`)
    case 'submitted': {
      const date = staged?.submittedAt ? formatClinicDateShort(staged.submittedAt) : ''
      return t(self ? `${D}.state.submittedSelf${consent}` : `${D}.state.submitted${consent}`, { date })
    }
    case 'rejected':
      return t(`${D}.state.rejected`)
    case 'missing':
      return t(`${D}.state.missing`)
  }
}

/** The dot next to the words: an expiry soon is a warning, an expired, refused or missing required document an error. */
export function typeStateTone(kind: DocumentStateKind, required = true): StatusTone {
  if (kind === 'valid') return 'success'
  if (kind === 'expiring' || kind === 'pending' || kind === 'submitted') return 'warning'
  if (kind === 'missing' && !required) return 'neutral'
  return 'error'
}

/** One document's own state in words (its row: « À vérifier », « Valide jusqu'au … », « Expiré : … », « Refusé »). */
export function documentStateLabel(document: ProfessionalDocument, today: string, self = false): string {
  if (document.status === 'pending') return t(self ? `${D}.state.pendingSelf` : `${D}.state.pending`)
  if (document.status === 'rejected') return t(`${D}.state.rejected`)
  if (isValid(document, today)) return document.expiresOn ? t(`${D}.state.validUntil`, { date: formatDateOnly(document.expiresOn) }) : t(`${D}.state.verified`)
  return document.expiresOn ? t(`${D}.state.expiredOn`, { date: formatDateOnly(document.expiresOn) }) : t(`${D}.state.expired`)
}

export function documentStateTone(document: ProfessionalDocument, today: string): StatusTone {
  if (document.status === 'pending') return 'warning'
  if (document.status === 'rejected') return 'error'
  return isValid(document, today) ? 'success' : 'error'
}

/** The card's dot for the viewer: the professional's own draft holding the type is a warning, not an error (P4-495). */
export function typeCardTone(entry: Pick<TypeDocuments, 'kind' | 'staged'>, self = false): StatusTone {
  return self && stagedInDraft(entry) ? 'warning' : typeStateTone(entry.kind)
}

/**
 * « Documents requis en règle : 2 sur 3 »: the required active types that are valid (or expiring)
 * on `today`; `awaiting` those that wait for the clinic's review (a document uploaded, or sent with
 * the questionnaire, P4-495), so the count does not read as a failure.
 */
export function requiredSummary(types: readonly TypeDocuments[]): { done: number; total: number; awaiting: number } {
  const required = types.filter((x) => x.type.required)
  return {
    done: required.filter((x) => x.kind === 'valid' || x.kind === 'expiring').length,
    total: required.length,
    awaiting: required.filter((x) => x.kind === 'pending' || x.kind === 'submitted').length,
  }
}

/**
 * The tab's two groups: the required active types (one card each, in the clinic's order), and the
 * documents of every other type (optional or archived), newest first.
 */
export function groupDocuments(types: readonly DocumentType[], data: ProfessionalDocuments): { required: TypeDocuments[]; others: ProfessionalDocument[] } {
  const required = types.filter((type) => type.isActive && type.required)
  const requiredIds = new Set(required.map((type) => type.id))
  return {
    required: required.map((type) => typeDocuments(type, data)),
    others: data.documents.filter((d) => !requiredIds.has(d.typeId)),
  }
}

/** The types one may upload now (active), required ones first, each list in the clinic's order. */
export function uploadableTypes(types: readonly DocumentType[]): DocumentType[] {
  const active = types.filter((type) => type.isActive)
  return [...active.filter((type) => type.required), ...active.filter((type) => !type.required)]
}

const MIME_LABEL: Readonly<Record<DocumentMimeType, string>> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'application/msword': 'Word (.doc)',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word (.docx)',
}

/** « PDF, JPEG ou PNG ». */
export function mimeListLabel(types: readonly DocumentMimeType[]): string {
  const labels = types.map((m) => MIME_LABEL[m])
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} ${t(`${D}.or`)} ${labels.at(-1)}`
}

export const mimeLabel = (type: DocumentMimeType) => MIME_LABEL[type]

/** « 10 Mo », « 0,5 Mo » (French decimal comma): a type's size cap. */
export const megabytesLabel = (bytes: number) => `${formatMegabytes(bytes)}\u00a0Mo`

/** A stored file's size: « 245 Ko » under 1 Mo, else « 2,4 Mo ». */
export const fileSizeLabel = (bytes: number) => (bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))}\u00a0Ko` : megabytesLabel(bytes))

/** Whether a stored file can be shown in the preview sheet (an image or a PDF); Word files are downloaded. */
export const isPreviewable = (mimeType: string) => mimeType === 'application/pdf' || mimeType.startsWith('image/')

// --- Who sees what, and what each may do (Tasks 4c.3, 4c.6) -------------------------------------

/** Staff on the record's tab, or the professional on « Mes documents » (P4-450). */
export type DocumentViewer = 'staff' | 'self'

/** What the viewer may do on this record (the database decides again, P4-401). */
export interface DocumentPermissions {
  /** « Téléverser » (`professionals.manage`; the provider on her own record). */
  upload: boolean
  /** Vérifier, Refuser, Modifier l'échéance (`professionals.documents.review`, never on one's own record). */
  review: boolean
  /** Supprimer (`professionals.documents.delete`, never on one's own record). */
  delete: boolean
}

export type DocumentAction = 'preview' | 'download' | 'verify' | 'reject' | 'redate' | 'delete'

/**
 * A document's actions, in the order they are offered: the file's (an image or a PDF opens in the
 * preview sheet; any file downloads), then the reviewer's: Vérifier a pending one, Refuser a
 * pending or verified one (never a consent signed through Documenso), Modifier l'échéance for a type with a rule (not once refused), and
 * Supprimer. A refused document has no file left (P4-404).
 */
export function documentActions(document: ProfessionalDocument, type: Pick<DocumentType, 'expiryRule'> | undefined, can: DocumentPermissions): DocumentAction[] {
  const actions: DocumentAction[] = []
  if (document.file && isPreviewable(document.file.mimeType)) actions.push('preview')
  // A consent signed through Documenso is downloaded from its signing part (core's split
  // downloads, P4-500: the document, the certificate and journal, the sealed proof), never here.
  if (document.file && document.signatureRequestId === null) actions.push('download')
  if (can.review && document.status === 'pending') actions.push('verify')
  // A consent signed through Documenso is never refused: its file is the signature's copy (P4-485).
  if (can.review && document.signatureRequestId === null && (document.status === 'pending' || document.status === 'verified')) actions.push('reject')
  if (can.review && type !== undefined && type.expiryRule !== 'none' && document.status !== 'rejected') actions.push('redate')
  if (can.delete) actions.push('delete')
  return actions
}

/** The verify and redate dialogs' date: the document's own, else the rule's default from `today`. */
export function proposedExpiry(document: Pick<ProfessionalDocument, 'expiresOn'>, type: Pick<DocumentType, 'expiryRule'>, today: string): string | null {
  return document.expiresOn ?? defaultExpiry(type.expiryRule, today)
}

/**
 * The last valid day typed in a dialog, checked as the RPCs do: required, a real date, at most
 * 2100-12-31, and (at upload) not before `min` (the clinic's today). Null when valid.
 */
export function expiryError(value: string, { min }: { min?: string } = {}): string | null {
  const v = value.trim()
  if (v === '') return t(`${D}.upload.dateRequired`)
  if (!isCalendarDate(v) || v < '2000-01-01') return t(`${D}.upload.dateInvalid`)
  if (v > '2100-12-31') return t(`${D}.upload.dateTooFar`)
  if (min !== undefined && v < min) return t(`${D}.upload.datePast`)
  return null
}

/** « Mes documents »' banner about the insurance (P4-454), if any. */
export type InsuranceBanner = { kind: 'expiring'; until: string } | { kind: 'expired' } | { kind: 'renewal_pending' } | { kind: 'in_questionnaire' }

/**
 * The insurance's banner on « Mes documents », by the tab's own rule (`typeDocuments`, the same
 * window as the reminders): expiring or expired; once a new proof waits for the clinic's review
 * (uploaded, or sent with the questionnaire, P4-495), a thank-you instead (the reminders stop then
 * too, P4-408); while it sits in her questionnaire not sent yet, a nudge to send it. None otherwise.
 */
export function insuranceBanner(
  types: readonly DocumentType[],
  data: Pick<ProfessionalDocuments, 'documents' | 'consent' | 'today'> & Partial<Pick<ProfessionalDocuments, 'staged'>>,
): InsuranceBanner | null {
  const type = types.find((x) => x.key === 'insurance' && x.isActive)
  if (!type) return null
  const entry = typeDocuments(type, data)
  // An expired one renewed in the questionnaire sent (P4-495): the thank-you, as for an upload.
  if (entry.kind === 'submitted') return entry.current ? { kind: 'renewal_pending' } : null
  if (entry.kind !== 'expiring' && entry.kind !== 'expired') return null
  if (entry.pending || entry.staged?.status === 'submitted') return { kind: 'renewal_pending' }
  // The new proof is in her questionnaire, not sent yet (« Téléverser » is not offered then).
  if (entry.staged) return { kind: 'in_questionnaire' }
  return entry.kind === 'expiring' && entry.until ? { kind: 'expiring', until: entry.until } : { kind: 'expired' }
}

const R = 'modules.professionals.settings.requiredDocuments'

/** « Documents requis »' reminders column: « 7 jours avant · chaque semaine après », « 30 et 7 jours avant », « Aucun ». */
export function remindersLabel(type: Pick<DocumentType, 'reminderDays' | 'weeklyAfterExpiry'>): string {
  const parts: string[] = []
  const days = type.reminderDays
  if (days.length === 1 && days[0] === 1) parts.push(t(`${R}.remindersBeforeOne`))
  else if (days.length > 0) parts.push(t(`${R}.remindersBefore`, { days: listLabel(days.map(String)) }))
  if (type.weeklyAfterExpiry) parts.push(t(`${R}.remindersWeekly`))
  if (parts.length === 0) return t(`${R}.remindersNone`)
  const text = parts.join(' · ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

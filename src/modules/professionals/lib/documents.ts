import { t } from '@/i18n'
import { formatMegabytes } from '@/shared/lib/files'
import { formatClinicDateShort, formatDateOnly, isCalendarDate } from '@/shared/lib/timezone'
import type { StatusTone } from '@/shared/ui/status-dot'
import type { ProfessionalDocument, ProfessionalDocuments, StagedDocument } from '../api/documents'
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
const reminderWindow = (type: DocumentType) => Math.max(0, ...type.reminderDays)

/**
 * `submitted`: nothing counts yet, but the questionnaire waiting for review holds it (P4-495).
 * `withdrawn`: the image consent was withdrawn (P4-549) and nothing replaced it.
 */
export type DocumentStateKind = 'valid' | 'expiring' | 'expired' | 'pending' | 'submitted' | 'rejected' | 'missing' | 'withdrawn'

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
  /** The last valid day shown (the current document's), if any; never for the image consent (P4-504). */
  until: string | null
  /** The type's other documents (superseded, older refusals), newest first. */
  older: ProfessionalDocument[]
  /** What the open questionnaire holds for this type (a draft, or sent and waiting), if anything (P4-495). */
  staged: StagedDocument | null
  /** `withdrawn`: the first day the image consent was no longer in force (P4-549). */
  withdrawnOn?: string | null
  /**
   * The image consent in force through her signed service contract (its article 6.2, P4-558), no
   * separate consent in force: when the contract was signed.
   */
  byContract?: { signedAt: string | null } | null
  /** The image-rights withdrawal recorded on the professional, when it is what the card says (P4-559). */
  contractWithdrawal?: ProfessionalDocument['withdrawal']
  /** Missing, but her next service contract will carry it: no separate consent to sign (P4-560). */
  byNextContract?: boolean
}

/** An image consent withdrawn on or before `today` (P4-549): no longer in force. */
export const isWithdrawn = (d: Pick<ProfessionalDocument, 'withdrawal'>, today: string) => d.withdrawal !== null && d.withdrawal.on <= today

/**
 * A verified document, unexpired and not withdrawn on `today`. For a type with a rule a document
 * without a date does not count (its type got a rule after it was verified), as the readiness
 * view's `max(expires_on)`.
 */
const isValid = (d: ProfessionalDocument, today: string, rule: DocumentExpiryRule = 'none') =>
  d.status === 'verified' && !isWithdrawn(d, today) && (d.expiresOn === null ? rule === 'none' : d.expiresOn >= today)

/**
 * The state of one type on the clinic's `today`: valid (or expiring within the type's largest
 * reminder), expired, pending (nothing valid yet, a document waits), refused (the newest one,
 * nothing waiting), missing. The image consent is a document like the others (signed through
 * Documenso, or a paper one), with no end date (P4-504, P4-507).
 */
export function typeDocuments(
  type: DocumentType,
  data: Pick<ProfessionalDocuments, 'documents' | 'today'> &
    Partial<Pick<ProfessionalDocuments, 'staged' | 'imageRightsContract' | 'imageRightsWithdrawal' | 'imageRightsByNextContract'>>,
): TypeDocuments {
  const { today } = data
  const docs = data.documents.filter((d) => d.typeId === type.id)
  const reviewed = docs.filter((d) => d.status === 'verified' || d.status === 'expired')
  // Newest first already: `reduce` keeps the first of equal dates.
  // Without a rule: the newest one in force, else the newest verified (withdrawn, P4-549).
  const current =
    type.expiryRule === 'none'
      ? (reviewed.find((d) => d.status === 'verified' && !isWithdrawn(d, today)) ?? reviewed.find((d) => d.status === 'verified') ?? reviewed[0] ?? null)
      : reviewed.reduce<ProfessionalDocument | null>((best, d) => (best === null || (d.expiresOn ?? '') > (best.expiresOn ?? '') ? d : best), null)
  const pending = docs.find((d) => d.status === 'pending') ?? null
  const rejected = pending === null && docs[0]?.status === 'rejected' ? docs[0] : null
  const older = docs.filter((d) => d !== current && d !== pending && d !== rejected)
  const staged = data.staged?.find((x) => x.typeKey === type.key) ?? null

  let kind: DocumentStateKind
  let until: string | null = null
  let withdrawnOn: string | null = null
  if (current && isValid(current, today, type.expiryRule)) {
    until = current.expiresOn
    const window = reminderWindow(type)
    kind = until !== null && window > 0 && daysBetween(today, until) <= window ? 'expiring' : 'valid'
  } else if (current && current.status === 'verified' && isWithdrawn(current, today)) {
    kind = 'withdrawn'
    withdrawnOn = current.withdrawal?.on ?? null
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
  // The image consent through her service contract (P4-558, P4-559): in force when no separate
  // consent is, or withdrawn (the withdrawal on the professional says when).
  let byContract: TypeDocuments['byContract'] = null
  let contractWithdrawal: TypeDocuments['contractWithdrawal'] = null
  const contract = type.key === 'image_consent' ? (data.imageRightsContract ?? null) : null
  if (contract && kind !== 'valid' && kind !== 'expiring') {
    contractWithdrawal = data.imageRightsWithdrawal ?? null
    if (contract.inForce) {
      kind = 'valid'
      until = null
      byContract = { signedAt: contract.signedAt }
    } else if (kind === 'missing' || kind === 'withdrawn') {
      kind = 'withdrawn'
      withdrawnOn = contractWithdrawal?.on ?? withdrawnOn
    }
  }
  const byNextContract = type.key === 'image_consent' && kind === 'missing' && (data.imageRightsByNextContract ?? false)
  // Sent with the questionnaire, waiting for review: never « Manquant » (nor « Refusé », « Expiré »).
  if (staged?.status === 'submitted' && (kind === 'missing' || kind === 'rejected' || kind === 'expired' || kind === 'withdrawn')) kind = 'submitted'
  return { type, kind, current, pending, rejected, until, older, staged, withdrawnOn, byContract, contractWithdrawal, byNextContract }
}

/**
 * Whether the file holds an image consent in force on the clinic's `today`: a verified
 * « Consentement droit à l'image » document (signed through Documenso, or a paper one) not
 * withdrawn by then (P4-549), or her signed service contract that grants it, not withdrawn
 * (P4-558; the database says `inForce`). It never expires (P4-504). The fiche prints the photo only
 * then (P4-512).
 */
export const imageConsentOnFile = (data: ImageConsentData) => imageConsentSource(data) !== null

type ImageConsentData = {
  documents: readonly Pick<ProfessionalDocument, 'typeKey' | 'status' | 'withdrawal'>[]
  today: string
} & Partial<Pick<ProfessionalDocuments, 'imageRightsContract'>>

/** Where the image consent in force comes from: a separate consent (`document`), else the service contract (`contract`); null when none. */
export function imageConsentSource(data: ImageConsentData): 'document' | 'contract' | null {
  if (data.documents.some((d) => d.typeKey === 'image_consent' && d.status === 'verified' && !isWithdrawn(d, data.today))) return 'document'
  return data.imageRightsContract?.inForce === true ? 'contract' : null
}

/** The image consent in force whose withdrawal is recorded for a later day (a notice period, P4-549); null otherwise. */
export const scheduledWithdrawal = (entry: Pick<TypeDocuments, 'type' | 'current'> & Partial<Pick<TypeDocuments, 'byContract' | 'contractWithdrawal'>>, today: string): string | null => {
  if (entry.type.key !== 'image_consent') return null
  // Through the contract (P4-559): the withdrawal recorded on the professional.
  const withdrawal = entry.byContract ? entry.contractWithdrawal : entry.current?.withdrawal
  return withdrawal && withdrawal.on > today ? withdrawal.on : null
}

/** « Retrait du consentement » is offered on an image consent in force (a scheduled one: to correct its date). */
export const withdrawalOffered = (entry: Pick<TypeDocuments, 'type' | 'kind'>, viewer: DocumentViewer, can: Pick<DocumentPermissions, 'review'>) =>
  viewer === 'staff' && can.review && entry.type.key === 'image_consent' && (entry.kind === 'valid' || entry.kind === 'expiring')

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
 * A type's state in words: « Valide jusqu'au 31 mars 2027 », « Vérifié », « Expire bientôt : valide
 * jusqu'au … », « Expiré : valide jusqu'au … » (always the last valid day, never « expiré le », a
 * day off, P4-413, P4-456, P4-511).
 * `self`: the professional reads it (« En attente de vérification par la clinique », not « À vérifier »).
 */
export function typeStateLabel(
  entry: Pick<TypeDocuments, 'kind' | 'until'> & Partial<Pick<TypeDocuments, 'staged' | 'withdrawnOn' | 'byContract' | 'byNextContract'>>,
  self = false,
): string {
  const { kind, until, staged = null, withdrawnOn = null, byContract = null, byNextContract = false } = entry
  const consent = staged?.kind === 'consent' ? 'Consent' : ''
  if (self && stagedInDraft({ kind, staged })) return t(`${D}.state.inDraftSelf${consent}`)
  // The image consent carried by the service contract (P4-558, P4-560).
  if (kind === 'valid' && byContract) {
    return byContract.signedAt ? t(`${D}.state.byContractOn`, { date: formatClinicDateShort(byContract.signedAt) }) : t(`${D}.state.byContract`)
  }
  if (kind === 'missing' && byNextContract) return t(self ? `${D}.state.byNextContractSelf` : `${D}.state.byNextContract`)
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
    case 'withdrawn':
      return withdrawnOn ? t(`${D}.state.withdrawnOn`, { date: formatDateOnly(withdrawnOn) }) : t(`${D}.state.withdrawn`)
  }
}

/** The dot next to the words: an expiry soon is a warning, an expired, refused or missing required document an error. */
function typeStateTone(kind: DocumentStateKind, required = true): StatusTone {
  if (kind === 'valid') return 'success'
  if (kind === 'expiring' || kind === 'pending' || kind === 'submitted') return 'warning'
  if (kind === 'missing' && !required) return 'neutral'
  return 'error'
}

/** One document's own state in words (its row: « À vérifier », « Valide jusqu'au … », « Expiré : … », « Refusé »). */
export function documentStateLabel(document: ProfessionalDocument, today: string, self = false): string {
  if (document.status === 'pending') return t(self ? `${D}.state.pendingSelf` : `${D}.state.pending`)
  if (document.status === 'rejected') return t(`${D}.state.rejected`)
  if (document.status === 'verified' && document.withdrawal && isWithdrawn(document, today)) {
    return t(`${D}.state.withdrawnOn`, { date: formatDateOnly(document.withdrawal.on) })
  }
  if (isValid(document, today)) return document.expiresOn ? t(`${D}.state.validUntil`, { date: formatDateOnly(document.expiresOn) }) : t(`${D}.state.verified`)
  return document.expiresOn ? t(`${D}.state.expiredOn`, { date: formatDateOnly(document.expiresOn) }) : t(`${D}.state.expired`)
}

export function documentStateTone(document: ProfessionalDocument, today: string): StatusTone {
  if (document.status === 'pending') return 'warning'
  if (document.status === 'rejected') return 'error'
  return isValid(document, today) ? 'success' : 'error'
}

/** The card's dot for the viewer: the professional's own draft holding the type is a warning, not an error (P4-495). */
export function typeCardTone(entry: Pick<TypeDocuments, 'kind' | 'staged'> & Partial<Pick<TypeDocuments, 'byNextContract'>>, self = false): StatusTone {
  // Carried by the contract still to sign (P4-560): nothing to chase on this card.
  if (entry.kind === 'missing' && entry.byNextContract) return 'neutral'
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

/** `date` + `days` (date-only values, no time zone). */
function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

/** The last day a withdrawal may be recorded for: a year after the clinic's `today` (366 days, as SQL). */
export const withdrawalLatest = (today: string) => shiftDays(today, 366)

/** The withdrawal date's problem in French, or null (P4-549: 2000-01-01 to a year from `today`). */
export function withdrawalDateError(value: string, today: string): string | null {
  const v = value.trim()
  if (v === '') return t(`${D}.withdraw.dateRequired`)
  if (!isCalendarDate(v) || v < '2000-01-01') return t(`${D}.withdraw.dateInvalid`)
  if (v > withdrawalLatest(today)) return t(`${D}.withdraw.dateTooFar`)
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
  data: Pick<ProfessionalDocuments, 'documents' | 'today'> & Partial<Pick<ProfessionalDocuments, 'staged'>>,
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

import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { CATALOG } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import { CONSENT_JSON, DOC_IDS, documentJson, documentsFixture, PHOTO_JSON, stagedJson } from '../test/fixtures-documents'
import {
  addTwelveMonths,
  consentLastDay,
  daysBetween,
  defaultExpiry,
  documentActions,
  expiryError,
  fileSizeLabel,
  groupDocuments,
  insuranceBanner,
  megabytesLabel,
  mimeListLabel,
  remindersLabel,
  requiredSummary,
  stagedInDraft,
  typeCardTone,
  typeDocuments,
  typeStateLabel,
  uploadableTypes,
  uploadOffered,
} from './documents'

const types = CATALOG.documentTypes
const type = (key: string) => {
  const found = types.find((x) => x.key === key)
  if (!found) throw new Error(key)
  return found
}
const ALL = { upload: true, review: true, delete: true }

describe('dates', () => {
  it('counts whole days and adds 12 months as SQL does (Feb 29 → Feb 28)', () => {
    expect(daysBetween('2027-03-24', '2027-03-31')).toBe(7)
    expect(daysBetween('2027-04-01', '2027-03-31')).toBe(-1)
    expect(addTwelveMonths('2026-10-09')).toBe('2027-10-09')
    expect(addTwelveMonths('2028-02-29')).toBe('2029-02-28')
  })

  it('proposes the next March 31 (P4-412), 12 months, or nothing', () => {
    expect(defaultExpiry('next_march_31', '2027-02-28')).toBe('2027-03-31')
    expect(defaultExpiry('next_march_31', '2027-03-01')).toBe('2028-03-31')
    expect(defaultExpiry('months_12', '2026-10-09')).toBe('2027-10-09')
    expect(defaultExpiry('none', '2026-10-09')).toBeNull()
  })

  it('an e-consent being withdrawn ends the day before the withdrawal takes effect', () => {
    const consent = documentsFixture().consent
    if (!consent) throw new Error('no consent')
    expect(consentLastDay(consent)).toBe('2027-10-08')
    expect(consentLastDay({ ...consent, withdrawalEffectiveOn: '2027-01-15' })).toBe('2027-01-14')
  })

  it('checks a typed last day: required, real, at most 2100, not before `min`', () => {
    expect(expiryError('')).toBe(t('modules.professionals.documents.upload.dateRequired'))
    expect(expiryError('2027-02-30')).toBe(t('modules.professionals.documents.upload.dateInvalid'))
    expect(expiryError('2101-01-01')).toBe(t('modules.professionals.documents.upload.dateTooFar'))
    expect(expiryError('2026-10-08', { min: '2026-10-09' })).toBe(t('modules.professionals.documents.upload.datePast'))
    expect(expiryError('2026-10-09', { min: '2026-10-09' })).toBeNull()
  })
})

describe('typeDocuments', () => {
  it('a verified insurance, then within the window, then past its last day', () => {
    const insurance = type('insurance')
    expect(typeDocuments(insurance, documentsFixture()).kind).toBe('valid')
    expect(typeDocuments(insurance, documentsFixture({ today: '2027-03-24' }))).toMatchObject({ kind: 'expiring', until: '2027-03-31' })
    expect(typeDocuments(insurance, documentsFixture({ today: '2027-04-01' }))).toMatchObject({ kind: 'expired', until: '2027-03-31' })
  })

  it('a verified document without a date does not count for a type with a rule (as the readiness view)', () => {
    expect(typeDocuments(type('insurance'), documentsFixture({ documents: [documentJson({ expires_on: null })] })).kind).toBe('expired')
    expect(typeDocuments(type('photo'), documentsFixture()).kind).toBe('valid')
  })

  it('the image consent: the later of the document’s last day and the e-consent’s', () => {
    const doc = documentJson({ id: DOC_IDS.cv, type_id: IDS.consentType, type_key: 'image_consent', expires_on: '2027-01-31' })
    expect(typeDocuments(type('image_consent'), documentsFixture({ documents: [doc] })).until).toBe('2027-10-08')
    expect(typeDocuments(type('image_consent'), documentsFixture({ documents: [doc], consent: null })).until).toBe('2027-01-31')
  })

  it('counts the latest last day, keeps a renewal apart, and the rest as older', () => {
    const data = documentsFixture({
      documents: [
        documentJson({ id: DOC_IDS.insuranceRenewal, status: 'pending', expires_on: '2028-03-31' }),
        documentJson({ id: DOC_IDS.insuranceOld, status: 'expired', expires_on: '2026-03-31' }),
        documentJson(),
      ],
    })
    const entry = typeDocuments(type('insurance'), data)
    expect(entry.current?.id).toBe(DOC_IDS.insurance)
    expect(entry.pending?.id).toBe(DOC_IDS.insuranceRenewal)
    expect(entry.older.map((d) => d.id)).toEqual([DOC_IDS.insuranceOld])
  })

  it('pending, refused (only when nothing waits since), missing; the e-consent satisfies the image consent', () => {
    expect(typeDocuments(type('insurance'), documentsFixture({ documents: [documentJson({ status: 'pending' })] })).kind).toBe('pending')
    expect(typeDocuments(type('insurance'), documentsFixture({ documents: [documentJson({ status: 'rejected', rejection_reason: 'Non.' })] })).kind).toBe('rejected')
    expect(typeDocuments(type('photo'), documentsFixture({ documents: [] })).kind).toBe('missing')
    expect(typeDocuments(type('image_consent'), documentsFixture()).kind).toBe('valid')
    expect(typeDocuments(type('image_consent'), documentsFixture({ consent: { ...CONSENT_JSON, expires_on: '2026-10-08' } })).kind).toBe('missing')
  })
})

describe('the questionnaire’s documents (P4-495)', () => {
  const D = 'modules.professionals.documents'
  const SENT = '2026-10-08T14:00:00+00:00'
  const date = formatClinicDateShort(SENT)
  const SELF = { upload: true }
  // A first questionnaire: nothing on file yet, no e-consent.
  const empty = { documents: [], consent: null }
  const staged = (status: 'draft' | 'submitted', over: Record<string, unknown> = {}) => [
    stagedJson({ status, ...over }),
    stagedJson({ type_key: 'insurance', kind: 'insurance', status, ...over }),
    stagedJson({ type_key: 'image_consent', kind: 'consent', status, ...over }),
  ]

  it('no questionnaire: the cards read their own state', () => {
    const entry = typeDocuments(type('photo'), documentsFixture(empty))
    expect(entry).toMatchObject({ kind: 'missing', staged: null })
    expect(typeStateLabel(entry, true)).toBe(t(`${D}.state.missing`))
    expect(uploadOffered(entry, 'self', SELF)).toBe(true)
  })

  it('sent and waiting: never « Manquant », in the professional’s words and in staff’s', () => {
    const data = documentsFixture({ ...empty, staged: staged('submitted') })
    const { required } = groupDocuments(types, data)
    expect(required.map((x) => x.kind)).toEqual(['submitted', 'submitted', 'submitted'])
    const [photo, insurance, consent] = required as [NonNullable<(typeof required)[0]>, NonNullable<(typeof required)[0]>, NonNullable<(typeof required)[0]>]
    expect(typeStateLabel(photo, true)).toBe(t(`${D}.state.submittedSelf`, { date }))
    expect(typeStateLabel(insurance, true)).toBe(`Envoyé avec votre questionnaire le ${date} · en attente de vérification par la clinique`)
    expect(typeStateLabel(insurance, false)).toBe(`Dans le questionnaire à réviser (envoyé le ${date})`)
    expect(typeStateLabel(consent, true)).toBe(t(`${D}.state.submittedSelfConsent`, { date }))
    expect(typeStateLabel(consent, false)).toBe(t(`${D}.state.submittedConsent`, { date }))
    expect(typeCardTone(photo, true)).toBe('warning')
    expect(typeCardTone(photo, false)).toBe('warning')
    // She is not offered a second copy; staff keep their upload.
    expect(uploadOffered(photo, 'self', SELF)).toBe(false)
    expect(uploadOffered(photo, 'staff', SELF)).toBe(true)
    // Not in order yet, but waiting: « 0 sur 3 · 3 en attente de vérification ».
    expect(requiredSummary(required)).toEqual({ done: 0, total: 3, awaiting: 3 })
  })

  it('sent and waiting over a refused or an expired document; a valid one keeps its state', () => {
    const refused = documentsFixture({ ...empty, documents: [documentJson({ status: 'rejected', rejection_reason: 'Illisible.' })], staged: staged('submitted') })
    expect(typeDocuments(type('insurance'), refused).kind).toBe('submitted')
    const expired = documentsFixture({ today: '2027-04-01', staged: staged('submitted') })
    expect(typeDocuments(type('insurance'), expired)).toMatchObject({ kind: 'submitted', until: '2027-03-31' })
    // An update renewing a valid photo: still valid (the review decides), and still no upload for her.
    const valid = typeDocuments(type('photo'), documentsFixture({ staged: staged('submitted') }))
    expect(valid.kind).toBe('valid')
    expect(uploadOffered(valid, 'self', SELF)).toBe(false)
  })

  it('a draft (not sent, or sent back): « Ajouté à votre questionnaire » for her; staff read the card as is', () => {
    for (const data of [documentsFixture({ ...empty, staged: staged('draft', { submitted_at: null }) }), documentsFixture({ ...empty, staged: staged('draft') })]) {
      const { required } = groupDocuments(types, data)
      const [photo, , consent] = required as [NonNullable<(typeof required)[0]>, unknown, NonNullable<(typeof required)[0]>]
      expect(photo.kind).toBe('missing')
      expect(stagedInDraft(photo)).toBe(true)
      expect(typeStateLabel(photo, true)).toBe('Ajouté à votre questionnaire, pas encore envoyé')
      expect(typeStateLabel(consent, true)).toBe(t(`${D}.state.inDraftSelfConsent`))
      expect(typeCardTone(photo, true)).toBe('warning')
      expect(typeStateLabel(photo, false)).toBe(t(`${D}.state.missing`))
      expect(typeCardTone(photo, false)).toBe('error')
      expect(uploadOffered(photo, 'self', SELF)).toBe(false)
      expect(requiredSummary(required)).toEqual({ done: 0, total: 3, awaiting: 0 })
    }
  })

  it('approved: nothing staged, the real documents count', () => {
    const { required } = groupDocuments(types, documentsFixture())
    expect(required.map((x) => x.kind)).toEqual(['valid', 'valid', 'valid'])
    expect(required.every((x) => x.staged === null)).toBe(true)
  })

  it('the insurance banner: a renewal sent with the questionnaire thanks her; one in her draft asks to send it', () => {
    expect(insuranceBanner(types, documentsFixture({ today: '2027-04-01', staged: staged('submitted') }))).toEqual({ kind: 'renewal_pending' })
    expect(insuranceBanner(types, documentsFixture({ today: '2027-03-26', staged: staged('submitted') }))).toEqual({ kind: 'renewal_pending' })
    expect(insuranceBanner(types, documentsFixture({ today: '2027-04-01', staged: staged('draft') }))).toEqual({ kind: 'in_questionnaire' })
    // A first insurance sent: the card says so, no banner.
    expect(insuranceBanner(types, documentsFixture({ ...empty, staged: staged('submitted') }))).toBeNull()
  })
})

describe('groups and summary', () => {
  it('one card per required active type, every other document under « Autres documents »', () => {
    const data = documentsFixture({ documents: [documentJson(), PHOTO_JSON, documentJson({ id: DOC_IDS.cv, type_id: IDS.cvType, type_key: 'cv', expires_on: null })] })
    const { required, others } = groupDocuments(types, data)
    expect(required.map((x) => x.type.key)).toEqual(['photo', 'insurance', 'image_consent'])
    expect(others.map((d) => d.id)).toEqual([DOC_IDS.cv])
    expect(requiredSummary(required)).toEqual({ done: 3, total: 3, awaiting: 0 })
  })

  it('offers required types first, never an archived one', () => {
    expect(uploadableTypes(types).map((x) => x.key)).toEqual(['photo', 'insurance', 'image_consent', 'cv', 'other'])
  })
})

describe('documentActions', () => {
  const doc = (over: Record<string, unknown>) => documentsFixture({ documents: [documentJson(over)] }).documents[0] as NonNullable<ReturnType<typeof documentsFixture>['documents'][0]>

  it('by status and permission', () => {
    expect(documentActions(doc({ status: 'pending' }), type('insurance'), ALL)).toEqual(['preview', 'download', 'verify', 'reject', 'redate', 'delete'])
    expect(documentActions(doc({}), type('insurance'), ALL)).toEqual(['preview', 'download', 'reject', 'redate', 'delete'])
    expect(documentActions(doc({ status: 'expired' }), type('insurance'), ALL)).toEqual(['preview', 'download', 'redate', 'delete'])
    expect(documentActions(doc({ status: 'rejected', file: null, rejection_reason: 'Non.' }), type('insurance'), ALL)).toEqual(['delete'])
    expect(documentActions(doc({ status: 'pending' }), type('insurance'), { upload: false, review: false, delete: false })).toEqual(['preview', 'download'])
    // A Word file is downloaded, not previewed; no end date to change on a type without a rule.
    const word = doc({ type_id: IDS.cvType, expires_on: null, file: { id: DOC_IDS.cvFile, name: 'cv.doc', mime_type: 'application/msword', size_bytes: 10 } })
    expect(documentActions(word, type('cv'), ALL)).toEqual(['download', 'reject', 'delete'])
  })
})

describe('insuranceBanner (P4-454)', () => {
  it('expiring, expired, a renewal waiting, or nothing', () => {
    expect(insuranceBanner(types, documentsFixture())).toBeNull()
    expect(insuranceBanner(types, documentsFixture({ today: '2027-03-26' }))).toEqual({ kind: 'expiring', until: '2027-03-31' })
    expect(insuranceBanner(types, documentsFixture({ today: '2027-04-01' }))).toEqual({ kind: 'expired' })
    const renewal = documentsFixture({ today: '2027-04-01', documents: [documentJson({ id: DOC_IDS.insuranceRenewal, status: 'pending' }), documentJson()] })
    expect(insuranceBanner(types, renewal)).toEqual({ kind: 'renewal_pending' })
    // Never sent one: the cards say « Manquant », no banner.
    expect(insuranceBanner(types, documentsFixture({ documents: [] }))).toBeNull()
  })
})

describe('labels', () => {
  it('file types and sizes in French', () => {
    expect(mimeListLabel(['application/pdf', 'image/jpeg', 'image/png'])).toBe('PDF, JPEG ou PNG')
    expect(mimeListLabel(['image/png'])).toBe('PNG')
    expect(megabytesLabel(10_485_760)).toBe('10 Mo')
    expect(megabytesLabel(524_288)).toBe('0,5 Mo')
    expect(fileSizeLabel(245_760)).toBe('240 Ko')
    expect(fileSizeLabel(2_516_582)).toBe('2,4 Mo')
  })

  it('the reminders column', () => {
    expect(remindersLabel({ reminderDays: [7], weeklyAfterExpiry: true })).toBe('7 jours avant · chaque semaine après')
    expect(remindersLabel({ reminderDays: [30, 7], weeklyAfterExpiry: false })).toBe('30 et 7 jours avant')
    expect(remindersLabel({ reminderDays: [1], weeklyAfterExpiry: false })).toBe('1 jour avant')
    expect(remindersLabel({ reminderDays: [], weeklyAfterExpiry: true })).toBe('Chaque semaine après')
    expect(remindersLabel({ reminderDays: [], weeklyAfterExpiry: false })).toBe('Aucun')
  })
})

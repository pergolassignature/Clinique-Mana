import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { CATALOG } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import { CONSENT_JSON, DOC_IDS, documentJson, documentsFixture, PHOTO_JSON } from '../test/fixtures-documents'
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
  typeDocuments,
  uploadableTypes,
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

describe('groups and summary', () => {
  it('one card per required active type, every other document under « Autres documents »', () => {
    const data = documentsFixture({ documents: [documentJson(), PHOTO_JSON, documentJson({ id: DOC_IDS.cv, type_id: IDS.cvType, type_key: 'cv', expires_on: null })] })
    const { required, others } = groupDocuments(types, data)
    expect(required.map((x) => x.type.key)).toEqual(['photo', 'insurance', 'image_consent'])
    expect(others.map((d) => d.id)).toEqual([DOC_IDS.cv])
    expect(requiredSummary(required)).toEqual({ done: 3, total: 3 })
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

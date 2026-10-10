import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { IDS } from '../test/fixtures'
import { REVIEW_CHANGED_FIELDS, REVIEW_JSON, submissionReview as review } from '../test/fixtures-review'
import {
  changedFieldKeys,
  clienteleDiff,
  fieldsToApply,
  fieldWarning,
  idsDiff,
  plainValueText,
  reviewPlan,
  submissionState,
  submissionStateLabel,
} from './submission-review'
import { minClientAgeLabel } from './display'

describe('reviewPlan', () => {
  it('splits each section into its changed fields and the others, in the questionnaire’s order', () => {
    const plan = reviewPlan(review())
    expect(plan.map((s) => s.section)).toEqual(REVIEW_JSON.submission.requested_sections)
    const personal = plan[0]
    expect(personal?.changed.map((f) => f.field)).toEqual(['personal_phone', 'city'])
    // Confirmed as is, or never answered: the record keeps its value either way.
    expect(personal?.unchanged.map((f) => f.field)).toEqual(['address_line1', 'address_line2', 'province', 'postal_code'])
  })
})

describe('what « Appliquer » sends', () => {
  it('checks every changed field by default, in the registry’s order', () => {
    expect(changedFieldKeys(review())).toEqual(REVIEW_CHANGED_FIELDS)
  })

  it('sends the checked changed fields only, never an unchanged one', () => {
    expect(fieldsToApply(review(), new Set(['motif_ids', 'city', 'postal_code']))).toEqual(['city', 'motif_ids'])
    expect(fieldsToApply(review(), new Set())).toEqual([])
  })
})

describe('sets', () => {
  it('says what an answer adds, removes and keeps', () => {
    expect(idsDiff([IDS.fr], [IDS.en, IDS.fr])).toEqual({ added: [IDS.en], removed: [], kept: [IDS.fr] })
    expect(idsDiff([IDS.anxiete], [IDS.psychose])).toEqual({ added: [IDS.psychose], removed: [IDS.anxiete], kept: [] })
    expect(idsDiff(null, 'oops')).toEqual({ added: [], removed: [], kept: [] })
  })

  it('names the clientèles added and removed, and the ★ changed on the ones kept', () => {
    const diff = clienteleDiff(
      [
        { id: IDS.couples, specialized: true },
        { id: IDS.children, specialized: false },
      ],
      [
        { id: IDS.couples, specialized: false },
        { id: IDS.children, specialized: true },
        { id: IDS.seniors, specialized: true },
      ],
    )
    expect(diff).toMatchObject({ added: [IDS.seniors], removed: [], starred: [IDS.children], unstarred: [IDS.couples] })
    expect([...diff.specialized]).toEqual([IDS.children, IDS.seniors])
  })
})

describe('plainValueText', () => {
  it('says each value in words', () => {
    expect(plainValueText('personal_phone', '+15145559876')).toBe('514 555-9876')
    expect(plainValueText('province', 'QC')).toBe('Québec')
    expect(plainValueText('years_experience', 1)).toBe('1 an')
    expect(plainValueText('years_experience', 12)).toBe('12 ans')
    expect(plainValueText('women_only', true)).toBe(t('modules.professionals.submission.values.yes'))
    expect(plainValueText('accepting_new_clients', false)).toBe(t('modules.professionals.submission.values.no'))
    expect(plainValueText('min_client_age', 14)).toBe(minClientAgeLabel(14))
    expect(plainValueText('availability_periods', ['evening', 'am'])).toBe('Matin · Soir')
    expect(plainValueText('city', 'Laval')).toBe('Laval')
  })

  it('reads empty as nothing (« Non indiqué » on screen)', () => {
    expect(plainValueText('address_line2', null)).toBeNull()
    expect(plainValueText('city', '')).toBeNull()
    expect(plainValueText('availability_periods', [])).toBeNull()
  })
})

describe('submissionState', () => {
  it.each([
    [{ status: 'draft', returned: false, appliedCount: null }, 'in_progress'],
    // `returned` (P4-474): sent back with a note, which only reviewers read.
    [{ status: 'draft', returned: true, appliedCount: null }, 'returned'],
    [{ status: 'submitted', returned: false, appliedCount: null }, 'to_review'],
    [{ status: 'approved', returned: false, appliedCount: 4 }, 'applied'],
    [{ status: 'approved', returned: false, appliedCount: 0 }, 'approved_unchanged'],
    [{ status: 'cancelled', returned: false, appliedCount: null }, 'cancelled'],
  ] as const)('%o reads %s', (row, state) => {
    expect(submissionState(row)).toBe(state)
    for (const kind of ['onboarding', 'update'] as const) expect(submissionStateLabel(state, kind)).not.toMatch(/^modules\./)
  })
})

// P4-378: what « Appliquer » would refuse, said before the click (the database still decides).
describe('fieldWarning', () => {
  const TODAY = '2026-10-08'
  it('an insurance whose expiry is before the clinic’s today; the day itself is still valid', () => {
    expect(fieldWarning({ field: 'insurance', submitted: { file_id: 'f', expires_on: '2026-10-07' } }, TODAY)).toEqual({ kind: 'insurance_expired', expiresOn: '2026-10-07' })
    expect(fieldWarning({ field: 'insurance', submitted: { file_id: 'f', expires_on: TODAY } }, TODAY)).toBeNull()
    expect(fieldWarning({ field: 'insurance', submitted: { file_id: 'f' } }, TODAY)).toBeNull()
  })

  it('a consent signed on a text replaced since; the latest text, or an older payload without the flag, is none', () => {
    // The consent is never applied (P4-507): no warning, whatever it holds.
    expect(fieldWarning({ field: 'consent', submitted: { version: 1, is_latest: false } }, TODAY)).toBeNull()
    expect(fieldWarning({ field: 'city', submitted: 'Laval' }, TODAY)).toBeNull()
  })
})

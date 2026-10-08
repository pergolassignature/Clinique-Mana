import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { defaultRangeSchema, levelSchema, marginSchema, ruleSchema } from './compensation'
import { issuesOf } from '../test/schema-helpers'

const V = 'modules.professionals.compensation.validation'
const none = () => null

describe('marginSchema', () => {
  it('sends the date string as typed and the percent rounded to 2 decimals', () => {
    expect(marginSchema(none).parse({ kind: 'consultation', marginPct: '27,555', effectiveFrom: ' 2026-11-01 ', note: '  ' })).toEqual({
      kind: 'consultation',
      marginPct: 27.56,
      effectiveFrom: '2026-11-01',
      note: null,
    })
  })

  it('refuses a percent out of 0–100, a missing kind and an impossible date', () => {
    expect(issuesOf(marginSchema(none), { kind: '', marginPct: '101', effectiveFrom: '2027-02-30', note: '' })).toEqual({
      kind: t(`${V}.kind`),
      marginPct: t(`${V}.percent`),
      effectiveFrom: t(`${V}.date`),
    })
  })

  it('bounds the date to 2000–2100 (P4-150)', () => {
    expect(issuesOf(marginSchema(none), { kind: 'workshop', marginPct: '25', effectiveFrom: '1999-12-31', note: '' })).toEqual({
      effectiveFrom: t(`${V}.dateBounds`),
    })
  })

  it('wants a start after the open margin of the chosen kind', () => {
    const minDateFor = (kind: string) => (kind === 'consultation' ? '2026-11-02' : null)
    expect(issuesOf(marginSchema(minDateFor), { kind: 'consultation', marginPct: '28', effectiveFrom: '2026-11-01', note: '' })).toEqual({
      effectiveFrom: t(`${V}.afterOpen.margin`, { date: '1 nov. 2026' }),
    })
    expect(issuesOf(marginSchema(minDateFor), { kind: 'workshop', marginPct: '28', effectiveFrom: '2026-11-01', note: '' })).toEqual({})
  })
})

describe('levelSchema', () => {
  it('reads whole numbers in their bounds', () => {
    expect(levelSchema(null).parse({ level: '2', sessions: '1 117', effectiveFrom: '2026-10-01', note: 'Compté dans GOrendezvous' })).toEqual({
      level: 2,
      sessions: 1117,
      effectiveFrom: '2026-10-01',
      note: 'Compté dans GOrendezvous',
    })
    expect(issuesOf(levelSchema(null), { level: '1,5', sessions: '-1', effectiveFrom: '2026-10-01', note: '' })).toEqual({
      level: t(`${V}.level`),
      sessions: t(`${V}.sessions`),
    })
  })
})

describe('defaultRangeSchema', () => {
  it('keeps the minimum under the maximum', () => {
    expect(issuesOf(defaultRangeSchema(none), { kind: 'consultation', min: '30', max: '25', effectiveFrom: '2027-01-01' })).toEqual({
      max: t(`${V}.minMax`),
    })
  })
})

describe('ruleSchema', () => {
  it('reads the bonuses in dollars and sends cents', () => {
    expect(
      ruleSchema(null).parse({
        stepSessions: '50',
        bonusPer50Min: '0,50',
        bonusPer30Min: '0,25 $',
        capPct: '25',
        capBasis: 'unconfirmed',
        effectiveFrom: '2027-01-01',
        note: '',
      }),
    ).toEqual({ stepSessions: 50, bonusPer50MinCents: 50, bonusPer30MinCents: 25, capPct: 25, capBasis: 'unconfirmed', effectiveFrom: '2027-01-01', note: null })
  })

  it('refuses a step of 0 and a bonus over 100 $', () => {
    expect(
      issuesOf(ruleSchema(null), { stepSessions: '0', bonusPer50Min: '101', bonusPer30Min: '0', capPct: '25', capBasis: 'unconfirmed', effectiveFrom: '2027-01-01', note: '' }),
    ).toEqual({ stepSessions: t(`${V}.step`), bonusPer50Min: t(`${V}.bonus`) })
  })
})

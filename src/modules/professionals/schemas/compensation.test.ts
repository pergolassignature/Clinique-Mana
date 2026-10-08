import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { agreementEndSchema, agreementSchema, decisionSchema, gridSchema, rateSchema, sessionsSchema } from './compensation'
import { issuesOf } from '../test/schema-helpers'

const V = 'modules.professionals.compensation.validation'
const none = () => null
const NO_PRICES = { 60: '', 50: '', 30: '' }

describe('sessionsSchema (P4-186)', () => {
  it('reads the month as its first day, blanks as 0 and an adjustment by half sessions', () => {
    expect(sessionsSchema('2026-10-01').parse({ month: '2026-09', long: '20', short: '', adjustment: '-2,5', note: ' ' })).toEqual({
      month: '2026-09-01',
      long: 20,
      short: 0,
      adjustment: -2.5,
      note: null,
    })
  })

  it('refuses a future month, fractions of sessions and a third of an adjustment', () => {
    expect(issuesOf(sessionsSchema('2026-10-01'), { month: '2026-11', long: '1,5', short: '-1', adjustment: '0,3', note: '' })).toEqual({
      month: t(`${V}.monthFuture`),
      long: t(`${V}.sessionsLong`),
      short: t(`${V}.sessionsShort`),
      adjustment: t(`${V}.adjustment`),
    })
    expect(issuesOf(sessionsSchema('2026-10-01'), { month: '', long: '2001', short: '0', adjustment: '', note: '' })).toEqual({
      month: t(`${V}.month`),
      long: t(`${V}.sessionsLong`),
    })
  })
})

describe('decisionSchema (P4-187)', () => {
  it('takes no rate for a suggestion: the database computes it', () => {
    expect(decisionSchema('suggested', null).parse({ pct: 'anything', effectiveFrom: '2026-11-01', note: '' })).toEqual({ pct: null, effectiveFrom: '2026-11-01', note: null })
  })

  it('wants a rate for an initial or custom rate, and a reason for a custom one', () => {
    expect(issuesOf(decisionSchema('custom', null), { pct: '101', effectiveFrom: '2026-11-01', note: '  ' })).toEqual({
      pct: t(`${V}.percent`),
      note: t(`${V}.customNote`),
    })
    expect(decisionSchema('initial', null).parse({ pct: '27,5', effectiveFrom: '2026-07-01', note: '' })).toEqual({ pct: 27.5, effectiveFrom: '2026-07-01', note: null })
  })

  it('starts after the open rate and within 2000–2100 (P4-150)', () => {
    expect(issuesOf(decisionSchema('maintained', '2026-07-02'), { pct: '', effectiveFrom: '2026-07-01', note: '' })).toEqual({
      effectiveFrom: t(`${V}.afterOpen.rate`, { date: '1 juil. 2026' }),
    })
    expect(issuesOf(decisionSchema('maintained', null), { pct: '', effectiveFrom: '2101-01-01', note: '' })).toEqual({ effectiveFrom: t(`${V}.dateBounds`) })
  })
})

describe('agreementSchema', () => {
  const values = { clientLabel: ' D-1042 ', duration: '50', professionalAmount: '85', clientPrice: '120,00 $', effectiveFrom: '2026-10-01', note: '' }

  it('reads both amounts in cents and the client reference tidied', () => {
    expect(agreementSchema().parse(values)).toEqual({
      clientLabel: 'D-1042',
      duration: 50,
      professionalAmountCents: 8500,
      clientPriceCents: 12000,
      effectiveFrom: '2026-10-01',
      note: null,
    })
  })

  it('wants both amounts, the pay never above the client price', () => {
    expect(issuesOf(agreementSchema(), { ...values, professionalAmount: '130' })).toEqual({ professionalAmount: t(`${V}.amountAbovePrice`) })
    expect(issuesOf(agreementSchema(), { ...values, clientPrice: '', clientLabel: '' })).toEqual({ clientPrice: t(`${V}.money`), clientLabel: t(`${V}.clientLabel`) })
    expect(issuesOf(agreementSchema(), { ...values, clientLabel: 'x'.repeat(41) })).toHaveProperty('clientLabel')
  })

  it('ends after the start', () => {
    expect(issuesOf(agreementEndSchema('2026-10-02'), { effectiveTo: '2026-10-01' })).toEqual({ effectiveTo: t(`${V}.endAfterStart`, { date: '1 oct. 2026' }) })
    expect(agreementEndSchema('2026-10-02').parse({ effectiveTo: '2027-03-01' })).toEqual({ effectiveTo: '2027-03-01' })
  })
})

describe('rateSchema', () => {
  it('reads a rate for a kind, after that kind’s open rate', () => {
    expect(rateSchema(none).parse({ kind: 'workshop', pct: '25', effectiveFrom: '2027-01-01' })).toEqual({ kind: 'workshop', pct: 25, effectiveFrom: '2027-01-01' })
    const minDateFor = (kind: string) => (kind === 'workshop' ? '2026-07-02' : null)
    expect(issuesOf(rateSchema(minDateFor), { kind: 'workshop', pct: '25', effectiveFrom: '2026-07-01' })).toEqual({
      effectiveFrom: t(`${V}.afterOpen.rate`, { date: '1 juil. 2026' }),
    })
  })
})

describe('gridSchema (P4-185)', () => {
  const tiers = [
    { threshold: '51', pct: '27,5' },
    { threshold: '0', pct: '28' },
  ]

  it('sorts the tiers, keeps the offered durations only, and sends the title', () => {
    expect(gridSchema('t1', null).parse({ effectiveFrom: '2027-01-01', tiers, prices: { 60: '', 50: '175', 30: '130,00' }, note: '' })).toEqual({
      titleId: 't1',
      effectiveFrom: '2027-01-01',
      tiers: [
        { threshold: 0, pct: 28 },
        { threshold: 51, pct: 27.5 },
      ],
      prices: [
        { duration: 50, clientPriceCents: 17500 },
        { duration: 30, clientPriceCents: 13000 },
      ],
      note: null,
    })
  })

  it('refuses tiers without 0, twice the same threshold, or a higher tier retaining more', () => {
    const base = { effectiveFrom: '2027-01-01', prices: { ...NO_PRICES, 50: '175' }, note: '' }
    expect(issuesOf(gridSchema('t1', null), { ...base, tiers: [{ threshold: '51', pct: '28' }] })).toEqual({ tiers: t(`${V}.tiersFromZero`) })
    expect(issuesOf(gridSchema('t1', null), { ...base, tiers: [{ threshold: '0', pct: '28' }, { threshold: '0', pct: '27' }] })).toEqual({ tiers: t(`${V}.tiersDistinct`) })
    expect(issuesOf(gridSchema('t1', null), { ...base, tiers: [{ threshold: '0', pct: '28' }, { threshold: '51', pct: '29' }] })).toEqual({ tiers: t(`${V}.tiersDecreasing`) })
  })

  it('wants at least one price, each 0,01 $ to 1 000 $', () => {
    expect(issuesOf(gridSchema('t1', null), { effectiveFrom: '2027-01-01', tiers, prices: NO_PRICES, note: '' })).toEqual({ 'prices.50': t(`${V}.pricesRequired`) })
    expect(issuesOf(gridSchema('t1', null), { effectiveFrom: '2027-01-01', tiers, prices: { ...NO_PRICES, 60: '1000,01' }, note: '' })).toEqual({ 'prices.60': t(`${V}.money`) })
  })
})

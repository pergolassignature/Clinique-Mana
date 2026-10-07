import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { isCalendarDate, newTaxRateSchema } from './schemas'

const errorsOf = (input: unknown) => {
  const result = newTaxRateSchema.safeParse(input)
  return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]))
}

describe('newTaxRateSchema', () => {
  it('turns the percentage into the stored fraction and keeps the date as typed', () => {
    expect(newTaxRateSchema.parse({ tax: 'qst', rate: '9,975', effective_from: '2027-01-01' })).toEqual({
      tax: 'qst',
      rate: 0.09975,
      effective_from: '2027-01-01',
    })
    expect(newTaxRateSchema.parse({ tax: 'gst', rate: ' 0 % ', effective_from: '2027-01-01' }).rate).toBe(0)
  })

  it.each(['', 'abc', '-1', '100', '150', '9,9,9'])('refuses the rate « %s » (0 % to less than 100 %)', (rate) => {
    expect(errorsOf({ tax: 'qst', rate, effective_from: '2027-01-01' })).toEqual({ rate: t('settings.tax.validation.rate') })
  })

  it('accepts up to 99,9999 %', () => {
    expect(newTaxRateSchema.parse({ tax: 'qst', rate: '99,9999', effective_from: '2027-01-01' }).rate).toBe(0.999999)
  })

  it.each(['', '2027-13-01', '2027-02-30', '01/01/2027'])('requires a calendar date (« %s » refused)', (effective_from) => {
    expect(errorsOf({ tax: 'qst', rate: '10', effective_from })).toEqual({ effective_from: t('settings.tax.validation.date') })
  })

  it('narrows the tax to gst or qst', () => {
    expect(errorsOf({ tax: 'hst', rate: '10', effective_from: '2027-01-01' })).toHaveProperty('tax')
  })
})

describe('isCalendarDate', () => {
  it('accepts a real yyyy-MM-dd day, leap days included', () => {
    expect(isCalendarDate('2027-01-01')).toBe(true)
    expect(isCalendarDate('2028-02-29')).toBe(true)
  })

  it.each(['', '2027-02-29', '2027-02-30', '2027-13-01', '2027-1-01', '01/01/2027', '2027-01-01T00:00'])('refuses « %s »', (v) => {
    expect(isCalendarDate(v)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { isCompleteTimeText, isDateInRange, normalizeTime, parseDateText, parseTimeText } from './date-time-entry'

describe('parseTimeText', () => {
  it.each([
    ['7', '07:00'],
    ['17', '17:00'],
    ['0', '00:00'],
    ['0700', '07:00'],
    ['730', '07:30'],
    ['1730', '17:30'],
    ['7:00', '07:00'],
    ['07:05', '07:05'],
    ['7h', '07:00'],
    ['7h30', '07:30'],
    ['7 h 30', '07:30'],
    ['7 H 30', '07:30'],
    ['7.30', '07:30'],
    ['7,30', '07:30'],
    ['07:00:00', '07:00'],
    ['  23:59 ', '23:59'],
  ])('reads « %s » as %s', (text, expected) => {
    expect(parseTimeText(text)).toBe(expected)
  })

  it.each(['', 'abc', '24', '24:00', '7:60', '7:5', '12345', '7 PM', '7am', '-1'])('refuses « %s »', (text) => {
    expect(parseTimeText(text)).toBeNull()
  })

  it('hands over only a finished time while typing', () => {
    expect(isCompleteTimeText('7')).toBe(false)
    expect(isCompleteTimeText('17')).toBe(false)
    expect(isCompleteTimeText('7h')).toBe(false)
    expect(isCompleteTimeText('0730')).toBe(true)
    expect(isCompleteTimeText('7:30')).toBe(true)
    expect(isCompleteTimeText('7 h 30')).toBe(true)
  })

  it('normalizes the database form and drops what is not a time', () => {
    expect(normalizeTime('09:00:00')).toBe('09:00')
    expect(normalizeTime('09:00')).toBe('09:00')
    expect(normalizeTime('')).toBe('')
    expect(normalizeTime(null)).toBe('')
    expect(normalizeTime('25:00')).toBe('')
  })
})

describe('parseDateText', () => {
  it.each([
    ['12/10/2026', '2026-10-12'],
    ['1/2/2026', '2026-02-01'],
    ['12-10-2026', '2026-10-12'],
    ['12.10.2026', '2026-10-12'],
    ['12 10 2026', '2026-10-12'],
    ['12102026', '2026-10-12'],
    ['2026-10-12', '2026-10-12'],
    ['2026/10/12', '2026-10-12'],
    ['12 oct 2026', '2026-10-12'],
    ['12 oct. 2026', '2026-10-12'],
    ['12 octobre 2026', '2026-10-12'],
    ['1er février 2026', '2026-02-01'],
    ['28 févr. 2026', '2026-02-28'],
    ['1 aout 2026', '2026-08-01'],
    ['1 août 2026', '2026-08-01'],
    ['3 juil. 2026', '2026-07-03'],
    ['3 juin 2026', '2026-06-03'],
    ['3 mai 2026', '2026-05-03'],
    ['3 sept. 2026', '2026-09-03'],
    ['3 déc. 2026', '2026-12-03'],
    ['29/02/2028', '2028-02-29'],
  ])('reads « %s » as %s', (text, expected) => {
    expect(parseDateText(text)).toBe(expected)
  })

  it.each(['', '12/10/26', '31/02/2026', '2026-13-01', '12 ju 2026', '12 xyz 2026', '29/02/2027', 'demain', '12/10'])('refuses « %s »', (text) => {
    expect(parseDateText(text)).toBeNull()
  })

  it('checks the bounds inclusively', () => {
    expect(isDateInRange('2026-10-12', '2026-10-12', '2026-10-12')).toBe(true)
    expect(isDateInRange('2026-10-11', '2026-10-12')).toBe(false)
    expect(isDateInRange('2026-10-13', null, '2026-10-12')).toBe(false)
    expect(isDateInRange('2026-10-13')).toBe(true)
  })
})

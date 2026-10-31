import { describe, expect, it } from 'vitest'
import { BIRTHDAY_DAYS, BIRTHDAY_MONTHS, birthdayLabel, isBirthday, joinBirthday, splitBirthday } from './birthday'

describe('a birthday (P4-564): a day of the year, never a year', () => {
  it('accepts every day that exists in some year, 29 February included', () => {
    expect(isBirthday('03-14')).toBe(true)
    expect(isBirthday('02-29')).toBe(true)
    expect(isBirthday('12-31')).toBe(true)
  })

  it('refuses a day no year has, a year, or a malformed value', () => {
    for (const value of ['02-30', '02-31', '04-31', '06-31', '09-31', '11-31', '13-01', '00-10', '03-00', '3-14', '1990-03-14', '']) {
      expect(isBirthday(value), value).toBe(false)
    }
  })

  it('reads « 14 mars », never « 03-14 », with no timezone to move it', () => {
    expect(birthdayLabel('03-14')).toBe('14 mars')
    expect(birthdayLabel('02-29')).toBe('29 février')
    expect(birthdayLabel('01-01')).toBe('1 janvier')
    expect(birthdayLabel(null)).toBe('')
    expect(birthdayLabel('04-31')).toBe('')
  })

  it('offers 31 days and the twelve months by name', () => {
    expect(BIRTHDAY_DAYS).toHaveLength(31)
    expect(BIRTHDAY_MONTHS.map((m) => m.label)).toEqual([
      'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
    ])
  })

  it('builds « MM-DD » from the two halves, partial while one is missing, empty when both are', () => {
    expect(joinBirthday('03', '14')).toBe('03-14')
    expect(joinBirthday('03', '')).toBe('03-')
    expect(joinBirthday('', '')).toBe('')
    expect(splitBirthday('03-14')).toEqual({ month: '03', day: '14' })
    expect(splitBirthday('')).toEqual({ month: '', day: '' })
  })
})

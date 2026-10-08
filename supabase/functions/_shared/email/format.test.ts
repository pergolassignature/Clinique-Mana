import { assertEquals, assertThrows } from '@std/assert'
import { formatClinicDateTime, formatDateOnly, formatPhone } from './format.ts'

const TORONTO = 'America/Toronto'

Deno.test('formatClinicDateTime: summer (EDT, UTC-4)', () => {
  assertEquals(
    formatClinicDateTime('2026-07-15T18:30:00Z', TORONTO),
    '15 juillet 2026 à 14 h 30',
  )
})

Deno.test('formatClinicDateTime: winter (EST, UTC-5)', () => {
  assertEquals(
    formatClinicDateTime('2026-01-15T18:30:00Z', TORONTO),
    '15 janvier 2026 à 13 h 30',
  )
})

Deno.test('formatClinicDateTime: either side of the spring change (2026-03-08)', () => {
  assertEquals(
    formatClinicDateTime('2026-03-08T06:30:00Z', TORONTO),
    '8 mars 2026 à 1 h 30',
  )
  assertEquals(
    formatClinicDateTime('2026-03-08T07:30:00Z', TORONTO),
    '8 mars 2026 à 3 h 30',
  )
})

Deno.test('formatClinicDateTime: either side of the fall change (2026-11-01)', () => {
  assertEquals(
    formatClinicDateTime('2026-11-01T05:30:00Z', TORONTO),
    '1 novembre 2026 à 1 h 30',
  )
  assertEquals(
    formatClinicDateTime('2026-11-01T06:30:00Z', TORONTO),
    '1 novembre 2026 à 1 h 30',
  )
  assertEquals(
    formatClinicDateTime('2026-11-01T07:30:00Z', TORONTO),
    '1 novembre 2026 à 2 h 30',
  )
})

Deno.test('formatClinicDateTime: the calendar day is the clinic’s, not UTC’s', () => {
  assertEquals(
    formatClinicDateTime('2026-07-16T02:30:00Z', TORONTO),
    '15 juillet 2026 à 22 h 30',
  )
})

Deno.test('formatClinicDateTime: whole hours, midnight and noon', () => {
  assertEquals(
    formatClinicDateTime('2026-10-15T13:00:00Z', TORONTO),
    '15 octobre 2026 à 9 h',
  )
  assertEquals(
    formatClinicDateTime('2026-10-15T04:00:00Z', TORONTO),
    '15 octobre 2026 à 0 h',
  )
  assertEquals(
    formatClinicDateTime('2026-10-15T16:05:00Z', TORONTO),
    '15 octobre 2026 à 12 h 05',
  )
})

Deno.test('formatClinicDateTime: Postgres text form and Date objects', () => {
  assertEquals(
    formatClinicDateTime('2026-07-15 18:30:00+00', TORONTO),
    '15 juillet 2026 à 14 h 30',
  )
  assertEquals(
    formatClinicDateTime(new Date('2026-07-15T18:30:00Z'), TORONTO),
    '15 juillet 2026 à 14 h 30',
  )
})

Deno.test('formatClinicDateTime: another timezone', () => {
  assertEquals(
    formatClinicDateTime('2026-07-15T18:30:00Z', 'America/Vancouver'),
    '15 juillet 2026 à 11 h 30',
  )
})

Deno.test('formatClinicDateTime: a date-only or invalid value is refused (null)', () => {
  // A bare date would be read as UTC midnight and shift a day (CLAUDE.md §9).
  assertEquals(formatClinicDateTime('2026-07-15', TORONTO), null)
  assertEquals(formatClinicDateTime('demain', TORONTO), null)
  // No offset: the runtime's own timezone would be assumed.
  assertEquals(formatClinicDateTime('2026-07-15T18:30:00', TORONTO), null)
  assertEquals(
    formatClinicDateTime('2026-07-15T18:30:00-04:00', TORONTO),
    '15 juillet 2026 à 18 h 30',
  )
  assertEquals(
    formatClinicDateTime('2026-07-15T18:30:00.123+0000', TORONTO),
    '15 juillet 2026 à 14 h 30',
  )
  assertEquals(formatClinicDateTime(new Date('x'), TORONTO), null)
})

Deno.test('formatClinicDateTime: an unknown timezone throws (configuration error)', () => {
  assertThrows(
    () => formatClinicDateTime('2026-07-15T18:30:00Z', 'Mars/Olympus'),
    RangeError,
  )
})

Deno.test('formatDateOnly: no timezone conversion (the CLAUDE.md §9 bug case)', () => {
  assertEquals(formatDateOnly('2020-01-01'), '1 janvier 2020')
  assertEquals(formatDateOnly('2026-12-31'), '31 décembre 2026')
})

Deno.test('formatDateOnly: ISO and Postgres forms keep their calendar date', () => {
  assertEquals(formatDateOnly('2026-03-08T00:00:00Z'), '8 mars 2026')
  assertEquals(formatDateOnly('2026-03-08 00:00:00+00'), '8 mars 2026')
})

Deno.test('formatDateOnly: every month name (date-fns fr)', () => {
  const names = Array.from(
    { length: 12 },
    (_, i) =>
      formatDateOnly(`2026-${String(i + 1).padStart(2, '0')}-01`)?.split(
        ' ',
      )[1],
  )
  assertEquals(names, [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ])
})

Deno.test('formatDateOnly: invalid calendar dates are refused (null)', () => {
  assertEquals(formatDateOnly('2026-02-30'), null)
  assertEquals(formatDateOnly('2026-13-01'), null)
  assertEquals(formatDateOnly('15/10/2026'), null)
  assertEquals(formatDateOnly(''), null)
})

Deno.test('formatDateOnly: 29 February only in a leap year', () => {
  assertEquals(formatDateOnly('2028-02-29'), '29 février 2028')
  assertEquals(formatDateOnly('2026-02-29'), null)
})

Deno.test('formatPhone: E.164 → 514 555-1234, like the web app', () => {
  assertEquals(formatPhone('+15145551234'), '514 555-1234')
  assertEquals(formatPhone('5145551234'), '5145551234')
})

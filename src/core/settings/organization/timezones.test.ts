import { describe, expect, it } from 'vitest'
import { CANADIAN_TIMEZONES, isCanadianTimezone, listTimezones, matchesTimezone, timezoneLabel } from './timezones'

describe('CANADIAN_TIMEZONES', () => {
  it('lists the eight Canadian zones, Eastern first, each a zone the runtime knows, named in French', () => {
    expect(CANADIAN_TIMEZONES.map((zone) => zone.value)).toEqual([
      'America/Toronto',
      'America/Halifax',
      'America/St_Johns',
      'America/Winnipeg',
      'America/Regina',
      'America/Edmonton',
      'America/Vancouver',
      'America/Whitehorse',
    ])
    for (const zone of CANADIAN_TIMEZONES) {
      expect(() => new Intl.DateTimeFormat('fr-CA', { timeZone: zone.value })).not.toThrow()
      expect(timezoneLabel(zone.value)).not.toMatch(/^settings\./) // every key exists
    }
    expect(timezoneLabel('America/Toronto')).toBe("Heure de l'Est (Montréal, Toronto)")
    expect(timezoneLabel('America/Whitehorse')).toBe('Heure du Yukon (Whitehorse)')
  })
})

describe('timezoneLabel', () => {
  it('names any other zone by its identifier, with spaces for underscores', () => {
    expect(timezoneLabel('Europe/Paris')).toBe('Europe/Paris')
    expect(timezoneLabel('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos Aires')
  })

  it('tells the Canadian zones apart', () => {
    expect(isCanadianTimezone('America/Vancouver')).toBe(true)
    expect(isCanadianTimezone('Europe/Paris')).toBe(false)
  })
})

describe('listTimezones', () => {
  it('lists the zones the browser knows, sorted, with the Canadian ones always in', () => {
    const zones = listTimezones(() => ['Europe/Paris', 'America/Toronto', 'Asia/Tokyo'])
    expect(zones).toEqual([...zones].sort())
    expect(new Set(zones).size).toBe(zones.length)
    for (const zone of CANADIAN_TIMEZONES) expect(zones).toContain(zone.value)
    expect(zones).toContain('Europe/Paris')
  })

  it('falls back to the Canadian zones when the browser cannot list them', () => {
    const canadian = CANADIAN_TIMEZONES.map((zone) => zone.value).sort()
    expect(listTimezones(null)).toEqual(canadian)
    expect(
      listTimezones(() => {
        throw new RangeError('unsupported')
      }),
    ).toEqual(canadian)
  })

  it('uses Intl.supportedValuesOf by default', () => {
    expect(listTimezones()).toContain('Europe/Paris')
  })
})

describe('matchesTimezone', () => {
  it('matches part of the label or identifier, ignoring case, accents and underscores', () => {
    expect(matchesTimezone('America/Toronto', 'montreal')).toBe(true)
    expect(matchesTimezone('America/Toronto', 'TORONTO')).toBe(true)
    expect(matchesTimezone('America/New_York', 'new york')).toBe(true)
    expect(matchesTimezone('Europe/Paris', ' paris ')).toBe(true)
    expect(matchesTimezone('Europe/Paris', 'tokyo')).toBe(false)
    expect(matchesTimezone('Europe/Paris', '')).toBe(true)
  })

  it.each(['john’s', 'john‘s', 'johnʼs', "john's"])('treats a curly apostrophe as a straight one (« %s »)', (search) => {
    expect(matchesTimezone('America/St_Johns', search)).toBe(true)
  })
})

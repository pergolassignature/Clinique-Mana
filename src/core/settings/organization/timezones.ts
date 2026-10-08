import { t, type TranslationKey } from '@/i18n'

/** The zones offered first in « Région », by French name, Eastern (most clinics) first. */
export const CANADIAN_TIMEZONES: readonly { value: string; labelKey: TranslationKey }[] = [
  { value: 'America/Toronto', labelKey: 'settings.region.zones.toronto' },
  { value: 'America/Halifax', labelKey: 'settings.region.zones.halifax' },
  { value: 'America/St_Johns', labelKey: 'settings.region.zones.stJohns' },
  { value: 'America/Winnipeg', labelKey: 'settings.region.zones.winnipeg' },
  { value: 'America/Regina', labelKey: 'settings.region.zones.regina' },
  { value: 'America/Edmonton', labelKey: 'settings.region.zones.edmonton' },
  { value: 'America/Vancouver', labelKey: 'settings.region.zones.vancouver' },
  { value: 'America/Whitehorse', labelKey: 'settings.region.zones.whitehorse' },
]

export function isCanadianTimezone(zone: string): boolean {
  return CANADIAN_TIMEZONES.some((option) => option.value === zone)
}

/** A Canadian zone's French name; any other zone's IANA identifier, with spaces for underscores. */
export function timezoneLabel(zone: string): string {
  const canadian = CANADIAN_TIMEZONES.find((option) => option.value === zone)
  return canadian ? t(canadian.labelKey) : zone.replace(/_/g, ' ')
}

/** The browser's list of zones, when it has one (Safari 15.4+, Chrome 99+, Firefox 93+). */
const browserTimezones = typeof Intl.supportedValuesOf === 'function' ? () => Intl.supportedValuesOf('timeZone') : null

/**
 * Every zone « Autre fuseau… » offers, sorted: the browser's list plus the Canadian zones (always
 * offered, whatever the browser's canonical names). Only the Canadian zones when it has no list.
 * The database checks the zone again on save (`validate_org_timezone`). `list` is for the tests.
 */
export function listTimezones(list: (() => string[]) | null = browserTimezones): string[] {
  let zones: string[] = []
  try {
    zones = list?.() ?? []
  } catch {
    zones = []
  }
  return [...new Set([...zones, ...CANADIAN_TIMEZONES.map((option) => option.value)])].sort()
}

/**
 * Lower case, without accents, underscores as spaces, curly apostrophes as straight ones (phones
 * type ’): « Montréal », « montreal » and « MONTREAL » match, and so do « St. John’s » and « St. John's ».
 */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/_/g, ' ')
    .toLowerCase()

/** Whether `search` is part of the zone's label or identifier (the picker's filter). */
export function matchesTimezone(zone: string, search: string): boolean {
  return fold(`${timezoneLabel(zone)} ${zone}`).includes(fold(search.trim()))
}

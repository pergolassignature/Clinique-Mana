import frCA from './fr-CA.json'

type TranslationDictionary = typeof frCA
type PathsToStringProps<T> = T extends string
  ? []
  : {
      [K in Extract<keyof T, string>]: [K, ...PathsToStringProps<T[K]>]
    }[Extract<keyof T, string>]

type Join<T extends string[], D extends string> = T extends []
  ? never
  : T extends [infer F]
    ? F
    : T extends [infer F, ...infer R]
      ? F extends string
        ? `${F}${D}${Join<Extract<R, string[]>, D>}`
        : never
      : string

export type TranslationKey = Join<PathsToStringProps<TranslationDictionary>, '.'>

const translations: Record<string, TranslationDictionary> = {
  'fr-CA': frCA,
}

const currentLocale = 'fr-CA'

function getNestedValue(obj: unknown, path: string): string {
  const keys = path.split('.')
  let current: unknown = obj

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
      current = (current as Record<string, unknown>)[key]
    } else {
      return path // Return the key if path not found
    }
  }

  return typeof current === 'string' ? current : path
}

/** A name that takes « d' » / « qu' »: it starts with a vowel or a y. A h never elides (h muet ignored). */
const ELIDING = /^[aeiouyàâäæéèêëîïôöœùûüÿ]/i

/** The placeholders that hold a person's name: « de {name} » and « que {firstName} » elide before a vowel. */
const NAME_PLACEHOLDERS = new Set(['name', 'firstName', 'fullName'])

/** U+202F, the narrow no-break space of French typography. */
export const NNBSP = '\u202F'

/**
 * French spacing of a translation template: a narrow no-break space (U+202F) before « ? ! ; : »
 * and inside « », so the mark never wraps onto a line of its own. Only a plain space is
 * replaced (a time « 14:30 », a URL « https:// » or a query « ?a=1 » has none before the mark);
 * guillemets get one even when the template has none. `t` applies it to the template before
 * interpolation, so a value (an email, a URL, a file name) is never rewritten.
 */
export function frenchSpacing(text: string): string {
  return text
    .replace(/ ([?!;:])/g, `${NNBSP}$1`)
    .replace(/«[ \u00A0\u202F]?/g, `«${NNBSP}`)
    .replace(/[ \u00A0\u202F]?»/g, `${NNBSP}»`)
}

/** Templates after `frenchSpacing`, by key (the dictionary never changes at runtime). */
const spacedTemplates = new Map<string, string>()
let spacingOn = true

/**
 * Tests only (`src/test/setup.ts` turns it off). Testing Library collapses every whitespace of the
 * DOM text to a plain space (`\s` includes U+202F) but compares the expected string as given, so a
 * `getByText(t(…))` would never match a spaced template. The i18n tests turn it back on.
 */
export function setFrenchSpacing(on: boolean): void {
  spacingOn = on
  spacedTemplates.clear()
}

function template(dictionary: TranslationDictionary, key: string): string {
  let text = spacedTemplates.get(key)
  if (text === undefined) {
    const raw = getNestedValue(dictionary, key)
    // A missing key returns the key itself: shown as is.
    text = raw === key || !spacingOn ? raw : frenchSpacing(raw)
    spacedTemplates.set(key, text)
  }
  return text
}

/**
 * The French text of `key`. `{name}`-style placeholders are replaced from `values`
 * (`t('nav.userMenu', { name: 'Camille' })`); a placeholder without a value stays as written.
 * « de » / « que » right before a name placeholder (`name`, `firstName`, `fullName`) elide when
 * the name starts with a vowel: « Fiche de {name} » → « Fiche d'Aurélie Essai », « Ce que
 * {firstName} a envoyé » → « Ce qu'Aurélie a envoyé ». The template gets French spacing first
 * (`frenchSpacing`): « Supprimer ? » holds a U+202F, never a plain space.
 */
export function t(key: TranslationKey, values?: Record<string, string>): string {
  const dictionary = translations[currentLocale]
  if (!dictionary) {
    console.warn(`Missing locale: ${currentLocale}`)
    return key
  }

  const text = template(dictionary, key)
  if (!values) return text
  return text.replace(/(\b(?:de|De|que|Que) )?\{(\w+)\}/g, (placeholder: string, before: string | undefined, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined
    if (value === undefined) return placeholder
    if (before && NAME_PLACEHOLDERS.has(name) && ELIDING.test(value)) return `${before.trimEnd().slice(0, -1)}'${value}`
    return `${before ?? ''}${value}`
  })
}

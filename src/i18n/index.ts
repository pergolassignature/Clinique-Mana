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

/**
 * The French text of `key`. `{name}`-style placeholders are replaced from `values`
 * (`t('nav.userMenu', { name: 'Camille' })`); a placeholder without a value stays as written.
 * « de » / « que » right before a name placeholder (`name`, `firstName`, `fullName`) elide when
 * the name starts with a vowel: « Fiche de {name} » → « Fiche d'Aurélie Essai », « Ce que
 * {firstName} a envoyé » → « Ce qu'Aurélie a envoyé ».
 */
export function t(key: TranslationKey, values?: Record<string, string>): string {
  const dictionary = translations[currentLocale]
  if (!dictionary) {
    console.warn(`Missing locale: ${currentLocale}`)
    return key
  }

  const text = getNestedValue(dictionary, key)
  if (!values) return text
  return text.replace(/(\b(?:de|De|que|Que) )?\{(\w+)\}/g, (placeholder: string, before: string | undefined, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined
    if (value === undefined) return placeholder
    if (before && NAME_PLACEHOLDERS.has(name) && ELIDING.test(value)) return `${before.trimEnd().slice(0, -1)}'${value}`
    return `${before ?? ''}${value}`
  })
}

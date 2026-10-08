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

/**
 * The French text of `key`. `{name}`-style placeholders are replaced from `values`
 * (`t('nav.userMenu', { name: 'Camille' })`); a placeholder without a value stays as written.
 */
export function t(key: TranslationKey, values?: Record<string, string>): string {
  const dictionary = translations[currentLocale]
  if (!dictionary) {
    console.warn(`Missing locale: ${currentLocale}`)
    return key
  }

  const text = getNestedValue(dictionary, key)
  if (!values) return text
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => (Object.hasOwn(values, name) ? (values[name] ?? placeholder) : placeholder))
}

export function useTranslation() {
  return { t, locale: currentLocale }
}

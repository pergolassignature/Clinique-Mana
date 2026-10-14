import type { PreferenceValue } from '@/core/preferences/api'

/**
 * The list's remembered filters (plan C3.2, done in C4; as Professionnels' P4-39): each person
 * finds « Clients » as she last filtered it, on any computer, through `user_preferences` (never
 * browser storage: reception computers are shared, decision #10). Only the URL's filters are kept
 * (`statut`, `professionnel`, `etiquette`, `dernier`, `tri`), never the search words: a name is personal data
 * (Loi 25), and it stays in the history entry only.
 */

/** The `user_preferences` key. */
export const CLIENTS_FILTERS_PREFERENCE = 'clients.list_filters'

/** The URL parameters that are filters (the ones remembered). */
export const FILTER_PARAMS = ['statut', 'professionnel', 'etiquette', 'dernier', 'tri'] as const

/** The filters of `params` as a query string, in a fixed order: '' when none narrows the list. */
export function filterQuery(params: URLSearchParams): string {
  const kept = new URLSearchParams()
  for (const key of FILTER_PARAMS) {
    const value = params.get(key)
    if (value) kept.set(key, value)
  }
  return kept.toString()
}

/** Pure: the value to store, or null (forget the preference) when nothing narrows the list. */
export function toRememberedFilters(params: URLSearchParams): PreferenceValue | null {
  const query = filterQuery(params)
  return query === '' ? null : { query }
}

/** Pure: the saved filters as URL parameters, or null when there are none (or the value is not ours). */
export function fromRememberedFilters(value: PreferenceValue | null | undefined): URLSearchParams | null {
  const query = value?.query
  if (typeof query !== 'string') return null
  const filters = filterQuery(new URLSearchParams(query))
  return filters === '' ? null : new URLSearchParams(filters)
}

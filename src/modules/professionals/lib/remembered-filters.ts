import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PreferenceValue } from '@/core/preferences/api'
import { usePreferenceWriter, useUserPreference } from '@/core/preferences/hooks'
import { filtersToSearchParams, isDefaultFilters, parseProfessionalsFilters, useProfessionalsFilters, type ProfessionalsFilters } from './filters'

/**
 * Remembered search and filters (PS Hub `usePersistedSearch`, P4-39): each person finds the list
 * as they last filtered it, on any computer, because the filters are a per-user preference
 * (`user_preferences`), never browser storage (decision #10, shared reception computers).
 */

/** The `user_preferences` key. */
export const LIST_FILTERS_PREFERENCE = 'professionals.list_filters'

/** The filters as the URL writes them, without the page: '' when nothing narrows the list. */
const queryOf = (filters: ProfessionalsFilters) => filtersToSearchParams({ ...filters, page: 1 }).toString()

/**
 * Pure: the stored value, the filters' query string without the page (P4-60: one serialisation,
 * read back by the URL parser), or null when nothing narrows the list (the preference is deleted).
 */
export function toRememberedFilters(filters: ProfessionalsFilters): PreferenceValue | null {
  const query = queryOf(filters)
  return query === '' ? null : { query }
}

/** Pure: the saved filters (page 1), or null when there are none. A stale or edited value falls back to the defaults, as a URL does. */
export function fromRememberedFilters(value: PreferenceValue | null | undefined): ProfessionalsFilters | null {
  const query = value?.query
  if (typeof query !== 'string') return null
  const filters = { ...parseProfessionalsFilters(new URLSearchParams(query)), page: 1 }
  return isDefaultFilters(filters) ? null : filters
}

type RestorePhase = 'waiting' | 'applying' | 'done'

/**
 * `useProfessionalsFilters` plus the person's remembered filters. The URL stays the source of
 * truth:
 * - on arrival with no filter in the URL, the saved filters are written into it (`replace`); a link
 *   or reload that carries filters wins and is left alone;
 * - each filter the person chooses is saved, debounced (`usePreferenceWriter`); clearing every
 *   filter forgets the preference. Page changes, links and Back are not saved.
 *
 * `restoring` is true until that first decision is applied (the preference is read in parallel
 * with the list), so the page shows its loading state rather than the unfiltered rows for a moment.
 * Once the saved filters are written, it ends as soon as the URL carries any filter: the person
 * may type in the search before the restored URL commits, and the URL is then the restored
 * filters plus the typing, never exactly what was restored. A choice made at any point ends it
 * too. A failed read or write never blocks the list.
 */
export function useRememberedProfessionalsFilters() {
  const preference = useUserPreference(LIST_FILTERS_PREFERENCE)
  const { schedule } = usePreferenceWriter(LIST_FILTERS_PREFERENCE)
  const [phase, setPhase] = useState<RestorePhase>('waiting')
  const onChange = useCallback(
    (filters: ProfessionalsFilters) => {
      // The person chose: whatever the restore was waiting for, the list follows their choice now.
      setPhase('done')
      schedule(toRememberedFilters(filters))
    },
    [schedule],
  )
  const state = useProfessionalsFilters({ onChange })
  const { filters, restore } = state
  const current = useMemo(() => queryOf(filters), [filters])

  useEffect(() => {
    if (phase !== 'waiting' || preference.isPending) return
    const saved = current === '' ? fromRememberedFilters(preference.data) : null
    if (saved) {
      restore(saved)
      setPhase('applying')
    } else {
      setPhase('done')
    }
  }, [phase, preference.isPending, preference.data, current, restore])

  // The URL update is a transition: the list waits for it rather than showing every row first.
  // Any filter in the URL ends the wait (the restored ones, or those typed meanwhile).
  const applied = phase === 'applying' && current !== ''
  useEffect(() => {
    if (applied) setPhase('done')
  }, [applied])

  const restoring = phase === 'waiting' || (phase === 'applying' && !applied)
  return { ...state, restoring }
}

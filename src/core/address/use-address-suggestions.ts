import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAddressSuggestions, fetchPlaceAddress, newPlacesSession, type AddressSuggestion, type PlaceAddress } from './api'
import { pauseSuggestions, suggestionsPaused } from './availability'

/** The pause in typing before asking (each request is billed). */
export const SUGGEST_DEBOUNCE_MS = 250
/** Fewer characters than this ask nothing (the function refuses them too). */
export const MIN_QUERY_LENGTH = 3
/** More characters than this ask nothing (not an address). */
export const MAX_QUERY_LENGTH = 200

/**
 * Suggestions for one address field (P4-220). Not React Query on purpose: the typed text is personal
 * data, so it is kept in no cache and in no query key (devtools, error reports), only in this
 * field's state.
 *
 * - `search(text)`: asks after `SUGGEST_DEBOUNCE_MS` of no typing, for 3–200 characters, unless the
 *   suggestions are paused (`availability.ts`); a newer search cancels the older request.
 * - `resolve(suggestion)`: the place's address, or null when it could not be read; it ends the
 *   session (the next search starts a new token).
 * - `cancel()`: stops a pending search and clears the list.
 * One session token per typing session: every autocomplete of the field and the one details call
 * share it, so Google bills them as one session; an abandoned session (no choice) is billed per
 * request.
 */
export function useAddressSuggestions() {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const session = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    request.current?.abort()
    request.current = null
    generation.current += 1
  }, [])

  useEffect(() => stop, [stop])

  const cancel = useCallback(() => {
    stop()
    setLoading(false)
    setSuggestions([])
  }, [stop])

  const search = useCallback(
    (text: string) => {
      stop()
      const query = text.trim()
      if (query.length < MIN_QUERY_LENGTH || query.length > MAX_QUERY_LENGTH || suggestionsPaused()) {
        setLoading(false)
        setSuggestions([])
        return
      }
      const id = generation.current
      timer.current = setTimeout(() => {
        timer.current = null
        const controller = new AbortController()
        request.current = controller
        session.current ??= newPlacesSession()
        setLoading(true)
        fetchAddressSuggestions(query, session.current, controller.signal)
          .then((found) => {
            if (id === generation.current) setSuggestions(found)
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted || id !== generation.current) return
            pauseSuggestions(error)
            setSuggestions([])
          })
          .finally(() => {
            if (id === generation.current) {
              request.current = null
              setLoading(false)
            }
          })
      }, SUGGEST_DEBOUNCE_MS)
    },
    [stop],
  )

  const resolve = useCallback(
    async (suggestion: AddressSuggestion, signal?: AbortSignal): Promise<PlaceAddress | null> => {
      cancel()
      const token = session.current ?? newPlacesSession()
      // The details call ends the session, whatever its outcome.
      session.current = null
      try {
        return await fetchPlaceAddress(suggestion.placeId, token, signal)
      } catch (error) {
        if (!signal?.aborted) pauseSuggestions(error)
        return null
      }
    },
    [cancel],
  )

  return { suggestions, loading, search, cancel, resolve }
}

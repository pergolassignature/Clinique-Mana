import { useCallback, useRef } from 'react'
import { useSearchParams, type NavigateOptions } from 'react-router-dom'

/** A change to the address: a value per key, `null` or `''` removing it. */
export type UrlParamsPatch = Record<string, string | null>

/** Applies a patch to a copy of the parameters. */
export function patchParams(base: URLSearchParams, patch: UrlParamsPatch): URLSearchParams {
  const next = new URLSearchParams(base)
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') next.delete(key)
    else next.set(key, value)
  }
  return next
}

/**
 * A page's filters in its address (`?tri=…&pour=…`), changed from the latest address rather than
 * from this render's.
 *
 * Two traps, found in the Clients list (#157):
 * - two changes in a row (before the address's re-render) would undo each other: react-router 6
 *   hands its functional setter the parameters of its last render too;
 * - a render that lands while a navigation is still pending (a list's data arriving) carries the
 *   old address: built on it, the next change drops a parameter or brings back a cleared one.
 *
 * So the latest parameters are kept here: replaced by each change made through `update`, and by a
 * new address only (Back, a link), never by a re-render of the same one.
 */
export function useUrlParams() {
  const [params, setParams] = useSearchParams()
  const latest = useRef(params)
  const seen = useRef(params)
  if (seen.current !== params) {
    seen.current = params
    latest.current = params
  }
  const update = useCallback(
    (patch: UrlParamsPatch | ((current: URLSearchParams) => URLSearchParams), options: NavigateOptions = { replace: true }) => {
      const next = typeof patch === 'function' ? patch(new URLSearchParams(latest.current)) : patchParams(latest.current, patch)
      latest.current = next
      setParams(next, options)
    },
    [setParams],
  )
  return { params, update }
}

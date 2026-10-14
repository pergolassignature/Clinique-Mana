import { useCallback, useLayoutEffect, useRef } from 'react'
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
 * Three traps, found in the Clients list (#157, then its A-2 flake):
 * - two changes in a row (before the address's re-render) would undo each other: react-router 6
 *   hands its functional setter the parameters of its last render too;
 * - a render that lands while a navigation is still pending (a list's data arriving) carries the
 *   old address: built on it, the next change drops a parameter or brings back a cleared one;
 * - a navigation is a transition (`v7_startTransition`): its render can be set aside and the old
 *   address committed again, so nothing may be learnt from a render. Only a committed address
 *   counts (a layout effect), and only one this hook did not make itself (Back, a link): the
 *   addresses it made are still on their way, and the latest change already holds them.
 */
export function useUrlParams() {
  const [params, setParams] = useSearchParams()
  const latest = useRef(params)
  /** The addresses `update` made that have not all been committed yet. */
  const made = useRef(new Set<string>())
  /** The address committed last: a change that leads back to it is not on its way anywhere. */
  const committed = useRef(params.toString())
  useLayoutEffect(() => {
    const search = params.toString()
    committed.current = search
    if (made.current.has(search)) {
      // One of ours arrived; once the latest one has, nothing is on its way any more.
      if (search === latest.current.toString()) made.current.clear()
      return
    }
    made.current.clear()
    latest.current = params
  }, [params])
  const update = useCallback(
    (patch: UrlParamsPatch | ((current: URLSearchParams) => URLSearchParams), options: NavigateOptions = { replace: true }) => {
      const next = typeof patch === 'function' ? patch(new URLSearchParams(latest.current)) : patchParams(latest.current, patch)
      latest.current = next
      // Back to the committed address: no new one will arrive, and the others are superseded.
      if (next.toString() === committed.current) made.current.clear()
      else made.current.add(next.toString())
      setParams(next, options)
    },
    [setParams],
  )
  return { params, update }
}

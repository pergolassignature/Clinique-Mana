import { useState } from 'react'

interface DraftState<T> {
  base: T
  baseKey: string
  values: T
  /** After a save of these values (their key): the server's next value is the person's own edit come back. */
  committed: string | null
}

/**
 * A form's draft over values the server may change under it (realtime: another counselor saves).
 * - While the draft is clean, the server's new values are taken at once.
 * - A server value equal to the draft (the person's own edit come back) is taken too: the draft is
 *   clean again.
 * - After a save, call `commit()` (the mutation's `onSuccess`): the server's next value becomes the
 *   base and the values, even when it differs in what only the server knows (a new row's id). If
 *   the person typed more since the save, her values are kept on the new base.
 * - Otherwise, while dirty, the person's edits are kept and `stale` says the request changed
 *   meanwhile, with `reload` to take the server's values (her edits dropped).
 * `base` is what the edits started from: a save sends what differs from it.
 */
export function useServerDraft<T>(server: T) {
  const serverKey = JSON.stringify(server)
  const [state, setState] = useState<DraftState<T>>(() => ({
    base: server,
    baseKey: serverKey,
    values: server,
    committed: null,
  }))
  const valuesKey = JSON.stringify(state.values)
  const dirty = valuesKey !== state.baseKey
  const changed = serverKey !== state.baseKey
  if (changed) {
    // Adopting during render (React's « storing information from previous renders »): each branch
    // moves the base to the server's value, so the next render no longer sees a change.
    if (!dirty || serverKey === valuesKey || (state.committed !== null && state.committed === valuesKey)) {
      setState({
        base: server,
        baseKey: serverKey,
        values: server,
        committed: null,
      })
    } else if (state.committed !== null) {
      setState({
        base: server,
        baseKey: serverKey,
        values: state.values,
        committed: null,
      })
    }
  }
  return {
    values: state.values,
    base: state.base,
    dirty,
    stale: changed && dirty && serverKey !== valuesKey && state.committed === null,
    setValues: (next: T | ((prev: T) => T)) =>
      setState((prev) => ({
        ...prev,
        values: typeof next === 'function' ? (next as (p: T) => T)(prev.values) : next,
      })),
    /** « Annuler »: back to what the edits started from. */
    reset: () => setState((prev) => ({ ...prev, values: prev.base })),
    /** « Recharger »: the server's current values. */
    reload: () =>
      setState({
        base: server,
        baseKey: serverKey,
        values: server,
        committed: null,
      }),
    /** A save succeeded: the server's next value is the person's own. */
    commit: () => setState((prev) => ({ ...prev, committed: JSON.stringify(prev.values) })),
  }
}

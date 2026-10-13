import { useState } from 'react'

/**
 * A form's draft over values the server may change under it (realtime: another counselor saves).
 * While the draft is clean, the server's new values are taken at once; while it is dirty, the
 * person's edits are kept and `stale` says the request changed meanwhile, with `reload` to take
 * the server's values (her edits dropped). `base` is what the edits started from: a save sends
 * what differs from it.
 */
export function useServerDraft<T>(server: T) {
  const serverKey = JSON.stringify(server)
  const [state, setState] = useState(() => ({ base: server, baseKey: serverKey, values: server }))
  const dirty = JSON.stringify(state.values) !== state.baseKey
  const changed = serverKey !== state.baseKey
  if (changed && !dirty) {
    // Adopting the server's values during render (React's « storing information from previous renders »).
    setState({ base: server, baseKey: serverKey, values: server })
  }
  return {
    values: state.values,
    base: state.base,
    dirty,
    stale: changed && dirty,
    setValues: (next: T | ((prev: T) => T)) =>
      setState((prev) => ({ ...prev, values: typeof next === 'function' ? (next as (p: T) => T)(prev.values) : next })),
    /** « Annuler »: back to what the edits started from. */
    reset: () => setState((prev) => ({ ...prev, values: prev.base })),
    /** « Recharger »: the server's current values. */
    reload: () => setState({ base: server, baseKey: serverKey, values: server }),
  }
}

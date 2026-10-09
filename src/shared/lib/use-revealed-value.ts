import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a revealed value stays on screen. */
export const REVEAL_DURATION_MS = 60_000

interface RevealOptions {
  /** The audited reveal RPC: the clear value, or null when nothing is stored. */
  fetchValue: () => Promise<string | null>
  /** The answer was null: nothing is stored any more (refetch the masked data). */
  onNothing?: () => void
  /** The reveal was refused or failed (the latest request only). Never receives the value. */
  onError: (error: unknown) => void
}

/**
 * A sensitive value (a bank account, a SIN) revealed on demand. Each `reveal` calls the audited
 * RPC. The value lives in this component's state only, never in React Query, storage or the URL,
 * and is dropped by `hide`, after `REVEAL_DURATION_MS`, when the browser tab is hidden (a shared
 * reception PC left as is) and on unmount. An answer that arrives after `hide` or after unmount is
 * ignored. Nothing is ever prefetched.
 *
 * The callbacks are read from the latest render, so they may be inline functions.
 */
export function useRevealedValue({ fetchValue, onNothing, onError }: RevealOptions) {
  const [value, setValue] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Bumped by every reveal, hide and unmount: an answer for an older request is dropped.
  const request = useRef(0)
  const latest = useRef({ fetchValue, onNothing, onError })
  latest.current = { fetchValue, onNothing, onError }

  const hide = useCallback(() => {
    request.current += 1
    clearTimeout(timer.current)
    setValue(null)
    setPending(false)
  }, [])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') hide()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      request.current += 1
      clearTimeout(timer.current)
      setValue(null)
    }
  }, [hide])

  const reveal = useCallback(async () => {
    const id = ++request.current
    clearTimeout(timer.current)
    setPending(true)
    try {
      const revealed = await latest.current.fetchValue()
      if (id !== request.current) return
      setValue(revealed)
      if (revealed === null) latest.current.onNothing?.()
      else timer.current = setTimeout(hide, REVEAL_DURATION_MS)
    } catch (error) {
      if (id !== request.current) return
      latest.current.onError(error)
    } finally {
      if (id === request.current) setPending(false)
    }
  }, [hide])

  return { value, pending, reveal, hide }
}

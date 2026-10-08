import { useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useReadyAccess } from '@/core/access/access-context'
import { deleteUserPreference, fetchUserPreference, saveUserPreference, type PreferenceValue } from './api'

/**
 * Keyed by user: the AccessProvider clears the whole cache when the signed-in user changes, and a
 * key that names the user means one person's preference can never be read as another's.
 */
export const preferenceKeys = {
  all: ['user-preferences'] as const,
  one: (userId: string, key: string) => [...preferenceKeys.all, userId, key] as const,
}

/** How long a changed preference waits before it is written: a burst (typing a search) is one write. */
export const PREFERENCE_WRITE_DELAY = 1500

/**
 * The signed-in user's value for `key` (null when none). Read once per session: every change made
 * here goes through the cache first (`usePreferenceWriter`), and another computer's changes are
 * read at the next sign-in or reload. A failed read is not retried, so a page waiting for it goes
 * on without it.
 */
export function useUserPreference(key: string) {
  const { user_id: userId } = useReadyAccess()
  return useQuery({
    queryKey: preferenceKeys.one(userId, key),
    queryFn: () => fetchUserPreference(userId, key),
    staleTime: Infinity,
    retry: false,
  })
}

interface WriterState {
  timer: ReturnType<typeof setTimeout> | undefined
  /** The value waiting for the timer; undefined when nothing waits. */
  pending: PreferenceValue | null | undefined
  /** What the server holds (serialised), when known: an unchanged value is not written again. */
  stored: string | undefined
  /** `stored` was taken from the cached read (once: after a failed write it stays unknown). */
  seeded: boolean
  /** Writes run one after the other, so an older value never lands after a newer one. */
  chain: Promise<void>
}

/**
 * Saves the signed-in user's value for `key`, debounced. `schedule(value)` updates the cache at
 * once (a page opened again restores it, even before the write) and writes after `delay` without
 * a new change; null forgets the preference (`delete_user_preference`). What waits is written at
 * once when the component unmounts (leaving the page).
 *
 * A failed write is quiet: the preference is a convenience, the page keeps working. The cache is
 * then re-read, so the next visit restores what the server really holds.
 */
export function usePreferenceWriter(key: string, delay = PREFERENCE_WRITE_DELAY) {
  const queryClient = useQueryClient()
  const { user_id: userId } = useReadyAccess()
  const state = useRef<WriterState>({ timer: undefined, pending: undefined, stored: undefined, seeded: false, chain: Promise.resolve() })

  const flush = useCallback(() => {
    const s = state.current
    clearTimeout(s.timer)
    s.timer = undefined
    if (s.pending === undefined) return
    const value = s.pending
    s.pending = undefined
    const serialized = JSON.stringify(value)
    if (serialized === s.stored) return
    s.stored = serialized
    s.chain = s.chain
      .then(() => (value === null ? deleteUserPreference(key) : saveUserPreference(key, value)))
      .catch(() => {
        s.stored = undefined
        void queryClient.invalidateQueries({ queryKey: preferenceKeys.one(userId, key) })
      })
  }, [key, userId, queryClient])

  const schedule = useCallback(
    (value: PreferenceValue | null) => {
      const s = state.current
      const queryKey = preferenceKeys.one(userId, key)
      // Before the first change, the cache holds what the server returned.
      if (!s.seeded) {
        s.seeded = true
        const read = queryClient.getQueryState<PreferenceValue | null>(queryKey)
        if (read?.status === 'success') s.stored = JSON.stringify(read.data ?? null)
      }
      queryClient.setQueryData<PreferenceValue | null>(queryKey, value)
      s.pending = value
      clearTimeout(s.timer)
      s.timer = setTimeout(flush, delay)
    },
    [key, userId, queryClient, flush, delay],
  )

  useEffect(() => flush, [flush])

  return { schedule, flush }
}

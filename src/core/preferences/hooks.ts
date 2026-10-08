import { useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useReadyAccess } from '@/core/access/access-context'
import { rpcErrorCode, rpcErrorHint } from '@/core/modules/errors'
import { deleteUserPreference, fetchUserPreference, onSessionUserChange, saveUserPreference, type PreferenceValue } from './api'

/**
 * Keyed by user: the AccessProvider clears the whole cache when the signed-in user changes, and a
 * key that names the user means one person's preference can never be read as another's. Narrow
 * on purpose (CLAUDE.md §8): a failed write re-reads `one(userId, key)` only, never `all`.
 */
export const preferenceKeys = {
  all: ['user-preferences'] as const,
  one: (userId: string, key: string) => [...preferenceKeys.all, userId, key] as const,
}

/** How long a changed preference waits before it is written: a burst (typing a search) is one write. */
export const PREFERENCE_WRITE_DELAY = 1500

/**
 * How many changes `usePreferenceWriter` has put in the cache, per user and key: a read that was
 * already on its way when one was made returns what the server held before it, so it is ignored.
 */
const localChanges = new Map<string, number>()
const changeSlot = (userId: string, key: string) => JSON.stringify([userId, key])
const localChangeCount = (userId: string, key: string) => localChanges.get(changeSlot(userId, key)) ?? 0

/**
 * The signed-in user's value for `key` (null when none). Read once per session: every change made
 * here goes through the cache first (`usePreferenceWriter`), and another computer's changes are
 * read at the next sign-in or reload. A read that resolves after a change made here keeps the
 * change (the read is older). A failed read is not retried, so a page waiting for it goes on
 * without it.
 */
export function useUserPreference(key: string) {
  const queryClient = useQueryClient()
  const { user_id: userId } = useReadyAccess()
  return useQuery({
    queryKey: preferenceKeys.one(userId, key),
    queryFn: async () => {
      const changesBefore = localChangeCount(userId, key)
      const value = await fetchUserPreference(userId, key)
      if (localChangeCount(userId, key) === changesBefore) return value
      return queryClient.getQueryData<PreferenceValue | null>(preferenceKeys.one(userId, key)) ?? null
    },
    staleTime: Infinity,
    retry: false,
  })
}

/** The database refused a write made for another user than the session's (the session changed since). */
const isUserMismatch = (error: unknown) => rpcErrorCode(error) === '42501' && rpcErrorHint(error) === 'user_mismatch'

interface WriterState {
  timer: ReturnType<typeof setTimeout> | undefined
  /** The value waiting for the timer and the user who chose it; undefined when nothing waits. */
  pending: { userId: string; value: PreferenceValue | null } | undefined
  /** What the server holds (serialised), when known: an unchanged value is not written again. */
  stored: string | undefined
  /** `stored` was taken from the cached read (once: after a failed write it stays unknown). */
  seeded: boolean
  /** Writes run one after the other, so an older value never lands after a newer one. */
  chain: Promise<void>
  /** Bumped when the session's user changes or signs out: every write queued before is dropped. */
  generation: number
}

/**
 * Saves the signed-in user's value for `key`, debounced. `schedule(value)` updates the cache at
 * once (a page opened again restores it, even before the write) and writes after `delay` without
 * a new change; null forgets the preference (`delete_user_preference`). What waits is written at
 * once when the component unmounts (leaving the page), when the page is hidden (another tab, the
 * window minimised) and when it is unloaded (`pagehide`: a reload, closing the tab).
 *
 * Each write names the user who made the change (captured by `schedule`), and the database refuses
 * it for any other session. On a sign-out or a change of user (here, or another tab switching the
 * shared session), what waits and what is queued is dropped, never sent; a refusal for another user
 * is dropped as quietly.
 *
 * A failed write is quiet: the preference is a convenience, the page keeps working. The cache is
 * then re-read, so the next visit restores what the server really holds.
 */
export function usePreferenceWriter(key: string, delay = PREFERENCE_WRITE_DELAY) {
  const queryClient = useQueryClient()
  const { user_id: userId } = useReadyAccess()
  const state = useRef<WriterState>({ timer: undefined, pending: undefined, stored: undefined, seeded: false, chain: Promise.resolve(), generation: 0 })
  const owner = useRef(userId)

  /** Forgets what waits and what is queued: they belong to a user who is no longer signed in here. */
  const drop = useCallback(() => {
    const s = state.current
    clearTimeout(s.timer)
    s.timer = undefined
    s.pending = undefined
    s.generation += 1
    s.stored = undefined
    s.seeded = false
  }, [])

  const flush = useCallback(() => {
    const s = state.current
    clearTimeout(s.timer)
    s.timer = undefined
    const pending = s.pending
    if (pending === undefined) return
    s.pending = undefined
    const serialized = JSON.stringify(pending.value)
    if (serialized === s.stored) return
    s.stored = serialized
    const generation = s.generation
    const { userId: user, value } = pending
    s.chain = s.chain.then(async () => {
      // Dropped while it waited behind another write (sign-out, another user): never sent.
      if (generation !== s.generation) return
      try {
        await (value === null ? deleteUserPreference(user, key) : saveUserPreference(user, key, value))
      } catch (error) {
        if (generation !== s.generation) return
        s.stored = undefined
        // Refused for another user: the session changed under it, nothing to re-read for this one.
        if (!isUserMismatch(error)) void queryClient.invalidateQueries({ queryKey: preferenceKeys.one(user, key) })
      }
    })
  }, [key, queryClient])

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
      localChanges.set(changeSlot(userId, key), localChangeCount(userId, key) + 1)
      queryClient.setQueryData<PreferenceValue | null>(queryKey, value)
      s.pending = { userId, value }
      clearTimeout(s.timer)
      s.timer = setTimeout(flush, delay)
    },
    [key, userId, queryClient, flush, delay],
  )

  // Another user in this tree (the access changed without a remount).
  useEffect(() => {
    if (owner.current === userId) return
    owner.current = userId
    drop()
  }, [userId, drop])

  // A sign-out or another user, heard from auth before React re-renders: the signed-in page then
  // unmounts with nothing left to write.
  useEffect(
    () =>
      onSessionUserChange((sessionUserId) => {
        if (sessionUserId !== owner.current) drop()
      }),
    [drop],
  )

  // The page may never unmount (a reload, a closed tab, a phone switching apps): write on the way out.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [flush])

  useEffect(() => flush, [flush])

  return { schedule, flush }
}

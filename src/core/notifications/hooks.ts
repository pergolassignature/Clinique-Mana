import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { useConfirmLeave } from '@/shared/lib/unsaved-changes-context'
import { toast } from '@/shared/ui/sonner'
import {
  countMyUnreadNotifications,
  listImportantUnreadNotifications,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  type Notice,
  type NoticesCursor,
  type UnreadCount,
} from './api'
import { noticeLinkPath } from './display'

export const notificationKeys = {
  all: ['notifications'] as const,
  count: () => [...notificationKeys.all, 'count'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  important: () => [...notificationKeys.all, 'important'] as const,
}

/** Marking notices read (a mutation key: the Accueil rows read whether theirs is pending). */
const MARK_READ_KEY = [...notificationKeys.all, 'mark-read'] as const

/**
 * How long a loaded count is fresh. A return to the tab, or a new observer (the bell mounting
 * again), refetches only once it is older than this: resizing or moving the desktop window can
 * report the page hidden and visible again several times a second, and with a count that was
 * always stale each return was one more request (seen as a burst of `count_my_unread_notifications`
 * in the 4a.20 walkthrough). The 60 s poll and the invalidations after a change made here ignore it.
 */
export const UNREAD_COUNT_FRESH_MS = 15_000

/**
 * The bell's dot: unread notices (90 days) and how many are important. The one polled query
 * (P3-24, instead of Realtime): every minute while the tab is visible, when it comes back (once
 * the count is older than UNREAD_COUNT_FRESH_MS), never in a background tab. Only the bell
 * observes it (one timer for the app); Accueil follows it without observing it
 * (useImportantNotices). Only signed-in screens poll: the bell lives in the signed-in shell, and
 * the cache is cleared when the user changes (#10).
 */
export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: notificationKeys.count(),
    queryFn: countMyUnreadNotifications,
    staleTime: UNREAD_COUNT_FRESH_MS,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}

/**
 * How many unread notices are important, as last loaded by the bell's count; undefined before
 * it loads. Read from the cache without observing the query: an observer would start a second
 * timer (a second request a minute).
 */
function useCachedImportantCount(queryClient: QueryClient): number | undefined {
  const subscribe = useCallback(
    (onChange: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryKey[0] === notificationKeys.all[0]) onChange()
      }),
    [queryClient],
  )
  return useSyncExternalStore(
    subscribe,
    () => queryClient.getQueryData<UnreadCount>(notificationKeys.count())?.important,
  )
}

/**
 * The bell's list, page by page (keyset on `created_at`, `id`; each page asks for one row more,
 * so « Charger plus » shows only when another page exists). Loads only while the popover is open;
 * removed when it closes, so the next opening loads one fresh page instead of refetching every
 * page seen.
 */
export function useNotificationList(open: boolean) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!open) queryClient.removeQueries({ queryKey: notificationKeys.list() })
  }, [open, queryClient])
  return useInfiniteQuery({
    queryKey: notificationKeys.list(),
    queryFn: ({ pageParam }) => listMyNotifications(pageParam),
    initialPageParam: null as NoticesCursor | null,
    getNextPageParam: ({ notices, hasMore }): NoticesCursor | undefined => {
      const last = notices[notices.length - 1]
      return hasMore && last ? { before: last.created_at, beforeId: last.id } : undefined
    },
    enabled: open,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

/**
 * Accueil « À surveiller »: up to 5 important unread notices. No timer of its own: it loads when
 * Accueil mounts, after a change made here (the mutations invalidate every notification query),
 * and when the bell's polled count says the number of important unread notices changed. So Accueil
 * costs one request a minute (the count), not two.
 */
export function useImportantNotices() {
  const queryClient = useQueryClient()
  const important = useCachedImportantCount(queryClient)
  const seen = useRef(important)
  useEffect(() => {
    const previous = seen.current
    seen.current = important
    // Before the count first loads there is nothing to compare: the list loads on mount anyway.
    if (previous === undefined || previous === important) return
    // A load already under way (e.g. after a change made here) is fresh enough: no second one.
    void queryClient.invalidateQueries({ queryKey: notificationKeys.important() }, { cancelRefetch: false })
  }, [important, queryClient])
  return useQuery({
    queryKey: notificationKeys.important(),
    queryFn: listImportantUnreadNotifications,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

/**
 * Marks notices read; the count, the list and « À surveiller » then reload. The mutation stays
 * pending until they have (onSettled returns the invalidation).
 */
function useMarkNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: MARK_READ_KEY,
    mutationFn: (ids: string[]) => markNotificationsRead(ids),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('notifications.markError'), 'notifications'))
    },
  })
}

/** « Tout marquer comme lu ». */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('notifications.markError'), 'notifications'))
    },
  })
}

/** Whether this notice is being marked read (Accueil: its button waits). */
export function useIsMarkingNotice(id: string): boolean {
  return useMutationState({
    filters: { mutationKey: MARK_READ_KEY, status: 'pending' },
    select: (mutation) => mutation.state.variables as string[] | undefined,
  }).some((ids) => ids?.includes(id) ?? false)
}

/**
 * Opens a notice. With a link to another page, it goes there through the unsaved-changes guard
 * and marks the notice read only once the user leaves: after « Rester » it stays unread. Without
 * a link (or one to the current page) it is marked read at once. A link that is not an app path
 * is never followed (noticeLinkPath). A read notice is not marked again.
 */
export function useOpenNotice() {
  const { mutate: markRead } = useMarkNotificationsRead()
  const confirmLeave = useConfirmLeave()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return useCallback(
    (notice: Notice) => {
      const markIfUnread = () => {
        if (!notice.is_read) markRead([notice.id])
      }
      const path = noticeLinkPath(notice.link_path)
      if (path && path !== pathname) {
        confirmLeave(() => {
          markIfUnread()
          navigate(path)
        })
      } else {
        markIfUnread()
      }
    },
    [markRead, confirmLeave, navigate, pathname],
  )
}

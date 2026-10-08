import { useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { useConfirmLeave } from '@/shared/lib/unsaved-changes-context'
import { toast } from '@/shared/ui/sonner'
import {
  NOTIFICATIONS_PAGE_SIZE,
  countMyUnreadNotifications,
  listImportantUnreadNotifications,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
  type Notice,
  type NoticesCursor,
} from './api'
import { noticeLinkPath } from './display'

export const notificationKeys = {
  all: ['notifications'] as const,
  count: () => [...notificationKeys.all, 'count'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  important: () => [...notificationKeys.all, 'important'] as const,
}

/**
 * Polling instead of Realtime (P3-24): every minute while the tab is visible, at once when it
 * comes back (always stale, so any return refetches), never in a background tab. Only signed-in
 * screens poll: the bell and Accueil live in the signed-in shell, and the cache is cleared when
 * the user changes (#10).
 */
const POLLING = {
  staleTime: 0,
  refetchInterval: 60_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
} as const

/** The bell's dot: unread notices (90 days) and how many are important. */
export function useUnreadNotificationCount() {
  return useQuery({ queryKey: notificationKeys.count(), queryFn: countMyUnreadNotifications, ...POLLING })
}

/**
 * The bell's list, page by page (keyset on `created_at`, `id`; a full page means there may be
 * more). Loads only while the popover is open; removed when it closes, so the next opening loads
 * one fresh page instead of refetching every page seen.
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
    getNextPageParam: (lastPage): NoticesCursor | undefined => {
      const last = lastPage[lastPage.length - 1]
      return lastPage.length === NOTIFICATIONS_PAGE_SIZE && last ? { before: last.created_at, beforeId: last.id } : undefined
    },
    enabled: open,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

/** Accueil « À surveiller »: up to 5 important unread notices, polled like the count. */
export function useImportantNotices() {
  return useQuery({ queryKey: notificationKeys.important(), queryFn: listImportantUnreadNotifications, ...POLLING })
}

/** Marks notices read; the count, the list and « À surveiller » then reload. */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
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

/**
 * Opens a notice: marks it read (if it is not), then goes to its link through the
 * unsaved-changes guard. A link that is not an app path is never followed (noticeLinkPath).
 */
export function useOpenNotice() {
  const { mutate: markRead } = useMarkNotificationsRead()
  const confirmLeave = useConfirmLeave()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return useCallback(
    (notice: Notice) => {
      if (!notice.is_read) markRead([notice.id])
      const path = noticeLinkPath(notice.link_path)
      if (path && path !== pathname) confirmLeave(() => navigate(path))
    },
    [markRead, confirmLeave, navigate, pathname],
  )
}

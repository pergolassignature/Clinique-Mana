import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { UnreadCount } from '@/core/notifications/api'
import { notificationKeys } from '@/core/notifications/hooks'
import { toast } from '@/shared/ui/sonner'
import { communicationsErrorMessage } from '../api/errors'
import {
  findSmsMessagePhone,
  getSmsThreadLink,
  listClientSms,
  listSmsThread,
  listSmsThreads,
  sendSms,
  setSmsConsent,
  setSmsThreadLink,
  type SmsConsentInput,
  type SmsView,
} from '../api/sms'
import { smsKeys } from './keys'

/** The clinic's threads, newest first, by view and search (SM-15); the previous rows stay while a search loads. */
export function useSmsThreads(view: SmsView = 'all', search = '') {
  return useQuery({
    queryKey: smsKeys.threadList(view, search),
    queryFn: () => listSmsThreads(view, search),
    staleTime: 0,
    placeholderData: keepPreviousData,
  })
}

/** A number's file (SM-15), read only for whoever holds `clients.view`. */
export function useSmsThreadLink(phone: string, enabled: boolean) {
  return useQuery({ queryKey: smsKeys.threadLink(phone), queryFn: () => getSmsThreadLink(phone), enabled })
}

/** « Rattacher » / « Détacher » a number; then the lists, its link and the files' panels are read again. */
export function useSetSmsThreadLink(phone: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (clientId: string | null) => setSmsThreadLink(phone, clientId),
    onSuccess: (_data, clientId) => {
      toast.success(clientId ? t('modules.communications.inbox.link.linkedToast') : t('modules.communications.inbox.link.unlinkedToast'))
    },
    onError: (error) => toast.error(communicationsErrorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: smsKeys.threads() }),
  })
}

/** A file's numbers and threads (SM-16). */
export function useClientSms(clientId: string) {
  return useQuery({ queryKey: smsKeys.clientNumbers(clientId), queryFn: () => listClientSms(clientId), enabled: clientId !== '', staleTime: 0 })
}

/** One thread's latest texts (none asked for until a number is chosen). */
export function useSmsThread(phone: string | null) {
  return useQuery({
    queryKey: smsKeys.thread(phone ?? ''),
    queryFn: () => listSmsThread(phone!),
    enabled: phone !== null,
    staleTime: 0,
  })
}

/** The number of the thread a notice points to (`?message=<id>`); null when the text is gone. */
export function useSmsMessagePhone(messageId: string | null) {
  return useQuery({
    queryKey: smsKeys.messagePhone(messageId ?? ''),
    queryFn: () => findSmsMessagePhone(messageId!),
    enabled: messageId !== null,
    staleTime: Infinity,
  })
}

/** The bell's unread total, as last loaded, read from the cache without observing the query (one poll for the app). */
function useCachedUnreadTotal(queryClient: QueryClient): number | undefined {
  const subscribe = useCallback(
    (onChange: () => void) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryKey[0] === notificationKeys.all[0]) onChange()
      }),
    [queryClient],
  )
  return useSyncExternalStore(subscribe, () => queryClient.getQueryData<UnreadCount>(notificationKeys.count())?.total)
}

/**
 * « Textos » follows the bell instead of polling (CLAUDE.md §8): a text received raises a notice,
 * so when the bell's polled unread count changes, the threads (and the open thread) reload.
 */
export function useFollowSmsNotices() {
  const queryClient = useQueryClient()
  const total = useCachedUnreadTotal(queryClient)
  const seen = useRef(total)
  useEffect(() => {
    const previous = seen.current
    seen.current = total
    if (previous === undefined || previous === total) return
    void queryClient.invalidateQueries({ queryKey: smsKeys.all }, { cancelRefetch: false })
  }, [total, queryClient])
}

/** Refreshes the threads and one thread (after a send or a consent; the row says how it went either way). */
function useRefreshThread() {
  const queryClient = useQueryClient()
  return (phone: string | null) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: smsKeys.threads() }),
      phone ? queryClient.invalidateQueries({ queryKey: smsKeys.thread(phone) }) : undefined,
    ])
}

/** A reply through `sms-send`; the caller shows the outcome (a refusal, the PBX's reason). */
export function useSendSms() {
  const refresh = useRefreshThread()
  return useMutation({
    mutationFn: (input: { to: string; body: string }) => sendSms(input),
    // `to` is the thread's number (E.164): a failed send also left its row « Échec ».
    onSettled: (_data, _error, input) => refresh(input.to),
  })
}

/** A consent recorded or withdrawn; the caller shows the outcome. */
export function useSetSmsConsent() {
  const refresh = useRefreshThread()
  return useMutation({
    mutationFn: (input: SmsConsentInput) => setSmsConsent(input),
    onSuccess: (saved) => refresh(saved.phone),
  })
}

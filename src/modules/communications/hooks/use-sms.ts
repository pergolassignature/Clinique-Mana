import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { UnreadCount } from '@/core/notifications/api'
import { notificationKeys } from '@/core/notifications/hooks'
import { findSmsMessagePhone, listSmsThread, listSmsThreads, sendSms, setSmsConsent, type SmsConsentInput } from '../api/sms'
import { smsKeys } from './keys'

/** The clinic's threads, newest first. */
export function useSmsThreads() {
  return useQuery({ queryKey: smsKeys.threads(), queryFn: listSmsThreads, staleTime: 0 })
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

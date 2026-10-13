import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import {
  disconnectMailConnection,
  fetchCommunicationsSettings,
  finishGmailConnect,
  listMailConnections,
  saveCommunicationsSettings,
  startGmailConnect,
  syncMailConnection,
  type CommunicationsSettings,
} from '../api/mailboxes'
import { communicationsErrorMessage } from '../api/errors'
import { leaveFor } from '../lib/leave-for'
import { mailKeys } from './keys'

/** The caller's mailboxes and their sync state. Always stale: a sync may have run since. */
export function useMailConnections() {
  return useQuery({ queryKey: mailKeys.connections(), queryFn: listMailConnections, staleTime: 0 })
}

/** The module's settings (the Pub/Sub topic). */
export function useCommunicationsSettings() {
  return useQuery({ queryKey: mailKeys.settings(), queryFn: fetchCommunicationsSettings })
}

/** Saves the topic; the effective settings returned are written into the cache. */
export function useSaveCommunicationsSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<CommunicationsSettings>) => saveCommunicationsSettings(patch),
    onSuccess: (saved) => {
      queryClient.setQueryData(mailKeys.settings(), saved)
      toast.success(t('modules.communications.settings.gmail.topic.saved'))
    },
  })
}

/**
 * « Connecter une boîte »: asks for Google's consent URL, then leaves the app for it. The browser
 * comes back to « /courriels/retour-google » (GoogleReturnPage).
 */
export function useStartGmailConnect() {
  return useMutation({
    mutationFn: () => startGmailConnect(),
    onSuccess: (url) => leaveFor(url),
    onError: (error) => toast.error(communicationsErrorMessage(error)),
  })
}

/**
 * The return from Google: stores the mailbox, then its first sync. A one-shot query keyed on the
 * state, not a mutation: the code is good once, and a query is asked once per key even when the
 * page mounts twice (StrictMode, a re-render), where a mutation started in an effect would post
 * the same code twice (the second refused as `link_used`) or lose its outcome. Never refetched,
 * never retried; `null` arguments ask nothing.
 */
export function useFinishGmailConnect(code: string | null, state: string | null) {
  const queryClient = useQueryClient()
  return useQuery({
    // Its own root, outside `mailKeys.all`: no invalidation of the module's queries may ever post the spent code again.
    queryKey: ['communications-google-return', state] as const,
    queryFn: async () => {
      try {
        const mailbox = await finishGmailConnect(code!, state!)
        // The first pass starts now; a failure here is not the connection's (the job retries).
        const sync = await syncMailConnection(mailbox.connection_id).catch(() => null)
        return { mailbox, sync }
      } finally {
        await queryClient.invalidateQueries({ queryKey: mailKeys.connections() })
      }
    },
    enabled: code !== null && state !== null,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

/** « Synchroniser » (or « Tout relire », `full`). The page says the outcome beside the button. */
export function useSyncMailConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ connectionId, full }: { connectionId: string; full?: boolean }) => syncMailConnection(connectionId, full),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: mailKeys.connections() }),
        queryClient.invalidateQueries({ queryKey: mailKeys.threads() }),
      ]),
  })
}

/** « Déconnecter ». Toasts here, so the outcome shows even if the row unmounts first. */
export function useDisconnectMailConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (connectionId: string) => disconnectMailConnection(connectionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: mailKeys.connections() })
      toast.success(t('modules.communications.settings.gmail.mailboxes.disconnected'))
    },
    onError: (error) => toast.error(communicationsErrorMessage(error)),
  })
}

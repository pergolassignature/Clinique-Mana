import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import { billingErrorMessage } from '../api/errors'
import {
  decideMatch,
  disconnectQbo,
  fetchInvoicePushStatus,
  listQboPushes,
  retryQboPush,
  setQboPushPaused,
  type PushStatus,
  fetchMatchCounts,
  fetchQboSettings,
  finishQboConnect,
  listMatches,
  saveAccountMapRow,
  searchClients,
  startQboConnect,
  syncQbo,
  type MatchDecision,
  type MatchStatus,
  type QboEnvironment,
} from '../api/quickbooks'
import { leaveFor } from '../lib/leave-for'
import { qboKeys } from './keys'

/** The connection, the accounts and the map. Always stale: the sync or the job may have run. */
export function useQboSettings() {
  return useQuery({ queryKey: qboKeys.settings(), queryFn: fetchQboSettings, staleTime: 0 })
}

/** « Connecter QuickBooks » / « Reconnecter »: Intuit's consent page, in the same tab. */
export function useStartQboConnect() {
  return useMutation({
    mutationFn: (environment: QboEnvironment) => startQboConnect(environment),
    onSuccess: (url) => leaveFor(url),
    onError: (error) => toast.error(billingErrorMessage(error)),
  })
}

/**
 * The return from Intuit: stores the company, then its first read. A one-shot query keyed on the
 * state (as Gmail's return, CM1): the code is good once, and a query is asked once per key even when
 * the page mounts twice. Never refetched, never retried; `null` arguments ask nothing.
 */
export function useFinishQboConnect(code: string | null, state: string | null, realmId: string | null) {
  const queryClient = useQueryClient()
  return useQuery({
    // Its own root, outside `qboKeys.all`: no invalidation may ever post the spent code again.
    queryKey: ['billing-qbo-return', state] as const,
    queryFn: async () => {
      try {
        const company = await finishQboConnect(code!, state!, realmId!)
        // The first read starts now; its failure is not the connection's (« Synchroniser » retries).
        const sync = await syncQbo().catch(() => null)
        return { company, sync }
      } finally {
        await queryClient.invalidateQueries({ queryKey: qboKeys.all })
      }
    },
    enabled: code !== null && state !== null && realmId !== null,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

/** « Synchroniser ». The page says the outcome beside the button. */
export function useSyncQbo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: syncQbo,
    onSettled: () => queryClient.invalidateQueries({ queryKey: qboKeys.all }),
  })
}

/** « Déconnecter ». Toasts here, so the outcome shows even if the card changes first. */
export function useDisconnectQbo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: disconnectQbo,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qboKeys.all })
      toast.success(t('modules.billing.qbo.connection.disconnected'))
    },
    onError: (error) => toast.error(billingErrorMessage(error)),
  })
}

/** One map row saved. */
export function useSaveAccountMapRow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, professionTitleId, accountId }: { key: string; professionTitleId: string | null; accountId: string | null }) =>
      saveAccountMapRow(key, professionTitleId, accountId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qboKeys.settings() }),
  })
}

/** The report's counts per status. */
export function useMatchCounts() {
  return useQuery({ queryKey: qboKeys.counts(), queryFn: fetchMatchCounts })
}

/** One page of one status, by name; the previous page stays while the next loads. */
export function useMatches(status: MatchStatus, search: string, page: number) {
  return useQuery({
    queryKey: qboKeys.list(status, search, page),
    queryFn: () => listMatches(status, search, page),
    placeholderData: keepPreviousData,
  })
}

/** Clients' search, for « Chercher un dossier » (two characters at least). */
export function useClientSearch(query: string) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: [...qboKeys.all, 'client-search', trimmed] as const,
    queryFn: () => searchClients(trimmed),
    enabled: trimmed.length >= 2,
    placeholderData: keepPreviousData,
  })
}

/** A decision on one customer (link, ignore, back to automatic). */
export function useDecideMatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ qboId, decision }: { qboId: string; decision: MatchDecision }) => decideMatch(qboId, decision),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qboKeys.matches() }),
  })
}

/** « Démarrer l'envoi » / « Mettre en pause » (FQ part 2). */
export function useSetQboPushPaused() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setQboPushPaused,
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: qboKeys.settings() }),
      queryClient.invalidateQueries({ queryKey: qboKeys.pushes() }),
    ]),
  })
}

/** « Envois à QuickBooks ». */
export function useQboPushes(status: PushStatus | null) {
  return useQuery({ queryKey: qboKeys.pushList(status), queryFn: () => listQboPushes(status) })
}

export function useRetryQboPush() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: retryQboPush,
    onSettled: () => queryClient.invalidateQueries({ queryKey: qboKeys.pushes() }),
  })
}

/** An invoice's state in QuickBooks. */
export function useInvoicePushStatus(invoiceId: string) {
  return useQuery({ queryKey: qboKeys.invoicePush(invoiceId), queryFn: () => fetchInvoicePushStatus(invoiceId) })
}

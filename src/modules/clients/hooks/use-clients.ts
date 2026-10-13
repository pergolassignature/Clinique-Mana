import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t, type TranslationKey } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage, rpcErrorCode } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import {
  anonymizeClient,
  CLIENT_HISTORY_PAGE_SIZE,
  CLIENTS_PAGE_SIZE,
  createClient,
  deleteClientInsurance,
  endClientPayer,
  fetchClientHistory,
  fetchClientsPage,
  fetchClientsReference,
  fetchClientSummary,
  fetchMyClients,
  findClientDuplicates,
  mergeClients,
  removeClientRelation,
  saveClientPayer,
  searchClients,
  setClientArchived,
  setClientNotes,
  setClientRelation,
  setClientTags,
  updateClient,
  upsertClientInsurance,
  type ClientFields,
  type ClientsPageQuery,
  type DuplicateQuery,
  type InsuranceInput,
  type PayerInput,
  type RelationInput,
} from '../api/clients'
import type { ClientListRow } from '../api/parse'
import { clientsKeys } from './keys'

const S = 'modules.clients.saved'

/** The list, one page at a time (keyset), the previous pages kept while a filter changes. */
export function useClientsList(query: ClientsPageQuery, enabled = true) {
  return useInfiniteQuery({
    queryKey: clientsKeys.list(query),
    enabled,
    queryFn: ({ pageParam }) => fetchClientsPage(query, pageParam),
    initialPageParam: null as ClientListRow['cursor'] | null,
    getNextPageParam: (lastPage) => (lastPage.length === CLIENTS_PAGE_SIZE ? lastPage.at(-1)?.cursor : undefined),
    placeholderData: keepPreviousData,
  })
}

/** The record's bundle; null when the file is not the clinic's. */
export function useClientRecord(id: string) {
  return useQuery({ queryKey: clientsKeys.record(id), queryFn: () => fetchClientSummary(id) })
}

/** Provenances, tags and professionals for the forms (change rarely: fresh for 5 minutes). */
export function useClientsReference() {
  return useQuery({ queryKey: clientsKeys.reference(), queryFn: fetchClientsReference, staleTime: 5 * 60_000 })
}

export function useMyClients() {
  return useQuery({ queryKey: clientsKeys.mine(), queryFn: fetchMyClients })
}

/**
 * The duplicates of the person being typed (the creation form's panel): only with a first and a
 * last name, the previous answer shown while the next one loads.
 */
export function useClientDuplicates(query: DuplicateQuery | null) {
  const key = query ? JSON.stringify(query) : ''
  return useQuery({
    queryKey: clientsKeys.duplicates(key),
    queryFn: ({ signal }) => findClientDuplicates(query as DuplicateQuery, signal),
    enabled: query !== null,
    placeholderData: keepPreviousData,
    gcTime: 0,
    staleTime: 0,
  })
}

/** The relation picker's search (2 characters at least). */
export function useClientSearch(query: string) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: clientsKeys.search(trimmed),
    queryFn: ({ signal }) => searchClients(trimmed, signal),
    enabled: trimmed.length >= 2,
    placeholderData: keepPreviousData,
  })
}

/** Where a mutation's failure is shown: under a field or in a dialog, else a toast. */
export interface MutationFeedback {
  onErrorMessage?: (message: string, error: unknown) => void
}

/**
 * A write of the module: on success the module's queries are refetched (awaited, so a dialog
 * closes onto fresh data) and the toast says what was done; a refusal goes where the user acts
 * (`feedback`), a 42501 also refetches the caller's access.
 */
function useClientsMutation<V, R>(mutationFn: (variables: V) => Promise<R>, successKey: TranslationKey | null, feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clientsKeys.all })
      if (successKey) toast.success(t(successKey))
    },
    onError: (error) => {
      if (rpcErrorCode(error) === '42501') void queryClient.invalidateQueries({ queryKey: accessKeys.all })
      const message = moduleErrorMessage(error, t('modules.clients.errors.saveFailed'), 'clients')
      if (feedback?.onErrorMessage) feedback.onErrorMessage(message, error)
      else toast.error(message)
    },
  })
}

export const useCreateClient = (feedback?: MutationFeedback) =>
  useClientsMutation(({ fields, confirmMedium }: { fields: ClientFields; confirmMedium: boolean }) => createClient(fields, confirmMedium), `${S}.created`, feedback)

export const useUpdateClient = (feedback?: MutationFeedback) =>
  useClientsMutation(({ id, fields }: { id: string; fields: ClientFields }) => updateClient(id, fields), `${S}.updated`, feedback)

export const useSetClientNotes = (feedback?: MutationFeedback) =>
  useClientsMutation(
    ({ id, adminNotes, specialAgreementNote }: { id: string; adminNotes: string | null; specialAgreementNote: string | null }) =>
      setClientNotes(id, adminNotes, specialAgreementNote),
    `${S}.updated`,
    feedback,
  )

export const useSetClientArchived = (feedback?: MutationFeedback) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => setClientArchived(id, archived),
    onSuccess: async (_, { archived }) => {
      await queryClient.invalidateQueries({ queryKey: clientsKeys.all })
      toast.success(t(archived ? `${S}.archived` : `${S}.restored`))
    },
    onError: (error) => {
      if (rpcErrorCode(error) === '42501') void queryClient.invalidateQueries({ queryKey: accessKeys.all })
      const message = moduleErrorMessage(error, t('modules.clients.errors.saveFailed'), 'clients')
      if (feedback?.onErrorMessage) feedback.onErrorMessage(message, error)
      else toast.error(message)
    },
  })
}

export const useSetClientRelation = (feedback?: MutationFeedback) =>
  useClientsMutation((input: RelationInput) => setClientRelation(input), `${S}.relation`, feedback)

export const useRemoveClientRelation = (feedback?: MutationFeedback) =>
  useClientsMutation(({ clientId, relatedId }: { clientId: string; relatedId: string }) => removeClientRelation(clientId, relatedId), `${S}.relationRemoved`, feedback)

export const useUpsertClientInsurance = (feedback?: MutationFeedback) =>
  useClientsMutation((input: InsuranceInput) => upsertClientInsurance(input), `${S}.insurance`, feedback)

export const useDeleteClientInsurance = (feedback?: MutationFeedback) =>
  useClientsMutation(({ clientId, rank }: { clientId: string; rank: 1 | 2 }) => deleteClientInsurance(clientId, rank), `${S}.insuranceRemoved`, feedback)

export const useSaveClientPayer = (feedback?: MutationFeedback) => useClientsMutation((input: PayerInput) => saveClientPayer(input), `${S}.payer`, feedback)

export const useEndClientPayer = (feedback?: MutationFeedback) => useClientsMutation((id: string) => endClientPayer(id), `${S}.payerEnded`, feedback)

export const useSetClientTags = (feedback?: MutationFeedback) =>
  useClientsMutation(({ clientId, tagIds }: { clientId: string; tagIds: string[] }) => setClientTags(clientId, tagIds), `${S}.tags`, feedback)

/** « Fusionner »: the kept file's id on success (the page then opens it). */
export const useMergeClients = (feedback?: MutationFeedback) =>
  useClientsMutation(
    ({ keepId, mergeId, fields }: { keepId: string; mergeId: string; fields: ClientFields }) => mergeClients(keepId, mergeId, fields),
    `${S}.merged`,
    feedback,
  )

export const useAnonymizeClient = (feedback?: MutationFeedback) => useClientsMutation((id: string) => anonymizeClient(id), `${S}.anonymized`, feedback)

/** The record's « Historique », 50 rows a page (keyset on the audit id), read when the tab opens. */
export function useClientHistory(id: string) {
  return useInfiniteQuery({
    queryKey: clientsKeys.history(id),
    queryFn: ({ pageParam }) => fetchClientHistory(id, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.length < CLIENT_HISTORY_PAGE_SIZE ? undefined : (last.at(-1)?.id ?? undefined)),
  })
}

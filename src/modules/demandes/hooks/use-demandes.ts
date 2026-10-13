import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useOrgRealtime } from '@/core/realtime/use-org-realtime'
import {
  addTask,
  assignDemande,
  cancelTask,
  completeTask,
  createDemande,
  fetchCounts,
  fetchDemandeConsents,
  fetchReference,
  getDemande,
  listDemandes,
  logContact,
  saveNote,
  saveParticipants,
  setDemandeSource,
  setDemandeState,
  setHandler,
  updateDemande,
  type ClosedReason,
  type ContactChannel,
  type ContactOutcome,
  type DemandeState,
  type InboxQuery,
  type ParticipantInput,
  type TaskKind,
  type TaskOutcome,
} from '../api/demandes'
import { demandesKeys } from './keys'

/** One page of the inbox; the previous page stays while the next loads. */
export function useInbox(query: InboxQuery, page: number) {
  return useQuery({
    queryKey: demandesKeys.list(query, page),
    queryFn: () => listDemandes(query, page),
    placeholderData: keepPreviousData,
  })
}

export function useInboxCounts() {
  return useQuery({ queryKey: demandesKeys.counts(), queryFn: fetchCounts })
}

/** The record's bundle (the tabs read it, never refetching it themselves). */
export function useDemande(id: string) {
  return useQuery({ queryKey: demandesKeys.record(id), queryFn: () => getDemande(id) })
}

export function useDemandesReference() {
  return useQuery({ queryKey: demandesKeys.reference(), queryFn: fetchReference, staleTime: 5 * 60_000 })
}

/**
 * The inbox and the records follow the other counselors' changes (D2, roadmap §3.1): ids come
 * on the clinic's Demandes channel, the screens read again with their own rights.
 */
export function useDemandesRealtime(enabled: boolean) {
  const queryClient = useQueryClient()
  useOrgRealtime(enabled ? 'demandes' : null, {
    onChange: (change) => {
      void queryClient.invalidateQueries({ queryKey: demandesKeys.waitlist() })
      void queryClient.invalidateQueries({ queryKey: demandesKeys.calls() })
      void queryClient.invalidateQueries({ queryKey: demandesKeys.propositions() })
      void queryClient.invalidateQueries({ queryKey: demandesKeys.lists() })
      void queryClient.invalidateQueries({ queryKey: demandesKeys.counts() })
      void queryClient.invalidateQueries({ queryKey: demandesKeys.record(change.recordId) })
    },
    onResync: () => void queryClient.invalidateQueries({ queryKey: demandesKeys.all }),
  })
}

/** After a write on a request: its lists, counters and record are read again. */
function useAfterWrite() {
  const queryClient = useQueryClient()
  return (id: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: demandesKeys.waitlist() }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.calls() }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.propositions() }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.counts() }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.record(id) }),
    ])
}

export function useCreateDemande() {
  const after = useAfterWrite()
  return useMutation({ mutationFn: createDemande, onSuccess: (id) => after(id) })
}

export function useUpdateDemande(id: string) {
  const after = useAfterWrite()
  return useMutation({ mutationFn: (patch: Record<string, unknown>) => updateDemande(id, patch), onSettled: () => after(id) })
}

/** « Provenance » corrected (D-26). */
export function useSetDemandeSource(id: string) {
  const after = useAfterWrite()
  return useMutation({
    mutationFn: ({ channel, referralSourceId }: { channel: string; referralSourceId: string | null }) => setDemandeSource(id, channel, referralSourceId),
    onSettled: () => after(id),
  })
}

export function useSetDemandeState(id: string) {
  const after = useAfterWrite()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ state, closedReason, professionalId = null }: { state: DemandeState; closedReason: ClosedReason | null; professionalId?: string | null }) =>
      setDemandeState(id, state, closedReason, professionalId),
    onSettled: (_data, _error, { state }) =>
      Promise.all([
        after(id),
        // A match links the files to her and may fill their primary professional (D-41): Clients' screens read again.
        state === 'matched' ? queryClient.invalidateQueries({ queryKey: ['clients'] }) : undefined,
      ]),
  })
}

/** The consents of the request's files (D-39), live: under the record, read again with it. */
export function useDemandeConsents(id: string, enabled = true) {
  return useQuery({ queryKey: demandesKeys.consents(id), queryFn: () => fetchDemandeConsents(id), enabled })
}

export function useAssignDemande(id: string) {
  const after = useAfterWrite()
  return useMutation({ mutationFn: (assignee: string | null) => assignDemande(id, assignee), onSettled: () => after(id) })
}

export function useLogContact() {
  const after = useAfterWrite()
  return useMutation({
    mutationFn: ({ id, channel, outcome, nextContactAt }: { id: string; channel: ContactChannel; outcome: ContactOutcome; nextContactAt: string | null }) =>
      logContact(id, channel, outcome, nextContactAt),
    onSettled: (_data, _error, { id }) => after(id),
  })
}

export function useAddTask(id: string) {
  const after = useAfterWrite()
  return useMutation({
    mutationFn: ({ kind, dueAt, assignee }: { kind: TaskKind; dueAt: string; assignee: string | null }) => addTask(id, kind, dueAt, assignee),
    onSettled: () => after(id),
  })
}

export function useCompleteTask(id: string) {
  const after = useAfterWrite()
  return useMutation({
    mutationFn: ({ taskId, outcome }: { taskId: string; outcome: TaskOutcome }) => completeTask(id, taskId, outcome),
    onSettled: () => after(id),
  })
}

export function useCancelTask(id: string) {
  const after = useAfterWrite()
  return useMutation({ mutationFn: (taskId: string) => cancelTask(id, taskId), onSettled: () => after(id) })
}

export function useSaveNote(id: string) {
  const after = useAfterWrite()
  return useMutation({ mutationFn: (note: string) => saveNote(id, note), onSettled: () => after(id) })
}

export function useSaveParticipants(id: string) {
  const after = useAfterWrite()
  return useMutation({ mutationFn: (participants: ParticipantInput[]) => saveParticipants(id, participants), onSettled: () => after(id) })
}

export function useSetHandler() {
  const after = useAfterWrite()
  return useMutation({
    mutationFn: ({ id, take, expected = null }: { id: string; take: boolean; expected?: string | null }) => setHandler(id, take, expected),
    onSettled: (_d, _e, { id }) => after(id),
  })
}

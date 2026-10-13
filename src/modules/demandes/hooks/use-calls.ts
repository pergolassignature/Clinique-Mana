import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { assignTask, listDiscoveryCalls, rescheduleTask, type CallsPeriod } from '../api/calls'
import { demandesKeys } from './keys'

/** The discovery calls of a period (D3b); live through `useDemandesRealtime`. */
export function useDiscoveryCalls(period: CallsPeriod) {
  return useQuery({ queryKey: demandesKeys.callsOf(period), queryFn: () => listDiscoveryCalls(period) })
}

/** Moving or giving a call: the calls, the inbox and the record read again. */
function useAfterCallWrite() {
  const queryClient = useQueryClient()
  return (demandeId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: demandesKeys.calls() }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.record(demandeId) }),
    ])
}

export function useRescheduleTask(demandeId: string) {
  const after = useAfterCallWrite()
  return useMutation({
    mutationFn: ({ taskId, dueAt }: { taskId: string; dueAt: string }) => rescheduleTask(demandeId, taskId, dueAt),
    onSettled: () => after(demandeId),
  })
}

export function useAssignTask(demandeId: string) {
  const after = useAfterCallWrite()
  return useMutation({
    mutationFn: ({ taskId, assignee }: { taskId: string; assignee: string | null }) => assignTask(demandeId, taskId, assignee),
    onSettled: () => after(demandeId),
  })
}

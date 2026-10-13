import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchOpenSlots, fetchPropositionServices, listPropositions, propose, withdrawProposition, type ProposeInput } from '../api/propositions'
import { demandesKeys } from './keys'

export function usePropositions(demandeId: string) {
  return useQuery({ queryKey: demandesKeys.propositionsOf(demandeId), queryFn: () => listPropositions(demandeId) })
}

export function usePropositionServices(professionalId: string | null) {
  return useQuery({
    queryKey: demandesKeys.propositionServices(professionalId ?? ''),
    queryFn: () => fetchPropositionServices(professionalId!),
    enabled: professionalId !== null,
  })
}

/** Her free slots, read fresh (never cached across openings: a slot may be taken meanwhile). */
export function useOpenSlots(professionalId: string | null, serviceId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: demandesKeys.openSlots(professionalId ?? '', serviceId ?? '', from, to),
    queryFn: () => fetchOpenSlots(professionalId!, serviceId!, from, to),
    enabled: professionalId !== null && serviceId !== null,
    placeholderData: keepPreviousData,
    staleTime: 0,
    gcTime: 0,
  })
}

/** After a proposal or a withdrawal: the proposals, the request (its state), the inbox, the waiting list (its offers). */
function useAfterPropositionWrite() {
  const queryClient = useQueryClient()
  return (demandeId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: demandesKeys.propositions() }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.waitlist() }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.record(demandeId) }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.counts() }),
    ])
}

export function usePropose() {
  const after = useAfterPropositionWrite()
  return useMutation({ mutationFn: (input: ProposeInput) => propose(input), onSettled: (_d, _e, input) => after(input.demandeId) })
}

export function useWithdrawProposition(demandeId: string) {
  const after = useAfterPropositionWrite()
  return useMutation({ mutationFn: (id: string) => withdrawProposition(id), onSettled: () => after(demandeId) })
}

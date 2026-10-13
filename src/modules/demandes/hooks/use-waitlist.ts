import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addWaitlistOffer,
  answerWaitlistOffer,
  exitWaitlist,
  fetchWaitlistLists,
  fetchWaitlistSettings,
  getWaitlistEntry,
  listWaitlist,
  logWaitlistContact,
  registerWaitlist,
  saveWaitlistSettings,
  invoiceWaitlistFee,
  setWaitlistFee,
  updateWaitlistEntry,
  type ExitReason,
  type OfferResponse,
  type RegisterInput,
  type WaitlistContactKind,
  type WaitlistOutcome,
  type WaitlistQuery,
  type WaitlistSettings,
} from '../api/waitlist'
import { fetchWaitlistCompatible } from '../api/waitlist-offers'
import { demandesKeys } from './keys'

/** A professional's compatible registrants, in list order (D4 part 2); with professionals.view. */
export function useWaitlistCompatible(professionalId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: demandesKeys.waitlistCompatible(professionalId ?? ''),
    queryFn: () => fetchWaitlistCompatible(professionalId!),
    enabled: enabled && professionalId !== null,
  })
}

export function useWaitlistLists() {
  return useQuery({ queryKey: demandesKeys.waitlistLists(), queryFn: fetchWaitlistLists })
}

export function useWaitlist(query: WaitlistQuery) {
  return useQuery({ queryKey: demandesKeys.waitlistList(query), queryFn: () => listWaitlist(query) })
}

/** A request's entries (its Suivi tab, the state control). */
export function useDemandeWaitlist(demandeId: string, enabled = true) {
  return useQuery({ queryKey: demandesKeys.waitlistOfDemande(demandeId), queryFn: () => listWaitlist({ demandeId }), enabled })
}

export function useWaitlistEntry(id: string | null) {
  return useQuery({ queryKey: demandesKeys.waitlistEntry(id ?? ''), queryFn: () => getWaitlistEntry(id!), enabled: id !== null })
}

/** After a write on the list: every list and entry, and the request (its state may have moved). */
function useAfterWaitlistWrite() {
  const queryClient = useQueryClient()
  return (demandeId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: demandesKeys.waitlist() }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.counts() }),
      queryClient.invalidateQueries({ queryKey: demandesKeys.record(demandeId) }),
    ])
}

export function useRegisterWaitlist(demandeId: string) {
  const after = useAfterWaitlistWrite()
  return useMutation({ mutationFn: (input: RegisterInput) => registerWaitlist(demandeId, input), onSettled: () => after(demandeId) })
}

/** The work on one entry (the side sheet); `demandeId` is its request. */
export function useWaitlistActions(entryId: string, demandeId: string) {
  const after = useAfterWaitlistWrite()
  const settled = { onSettled: () => after(demandeId) }
  return {
    update: useMutation({ mutationFn: (patch: Record<string, unknown>) => updateWaitlistEntry(entryId, patch), ...settled }),
    invoice: useMutation({
      mutationFn: () => invoiceWaitlistFee(entryId),
      ...settled,
    }),
    fee: useMutation({
      mutationFn: ({ status, reason }: { status: 'to_invoice' | 'paid' | 'waived'; reason: string | null }) => setWaitlistFee(entryId, status, reason),
      ...settled,
    }),
    contact: useMutation({
      mutationFn: ({ kind, outcome, nextContactAt }: { kind: WaitlistContactKind; outcome: WaitlistOutcome; nextContactAt: string | null }) =>
        logWaitlistContact(entryId, kind, outcome, nextContactAt),
      ...settled,
    }),
    offer: useMutation({
      mutationFn: ({ professionalId, slots }: { professionalId: string; slots: { starts_at: string; ends_at: string }[] }) =>
        addWaitlistOffer(entryId, professionalId, slots),
      ...settled,
    }),
    answer: useMutation({
      mutationFn: ({ offerId, response }: { offerId: string; response: OfferResponse }) => answerWaitlistOffer(entryId, offerId, response),
      ...settled,
    }),
    exit: useMutation({
      mutationFn: ({ reason, professionalId }: { reason: ExitReason; professionalId: string | null }) => exitWaitlist(entryId, reason, professionalId),
      ...settled,
    }),
  }
}

export function useWaitlistSettings() {
  return useQuery({ queryKey: demandesKeys.waitlistSettings(), queryFn: fetchWaitlistSettings })
}

export function useSaveWaitlistSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (s: WaitlistSettings) => saveWaitlistSettings(s),
    onSuccess: (saved) => queryClient.setQueryData(demandesKeys.waitlistSettings(), saved),
  })
}

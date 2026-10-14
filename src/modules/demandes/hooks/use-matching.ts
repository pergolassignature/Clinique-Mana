import { useQuery } from '@tanstack/react-query'
import { fetchDemandeMatch, fetchNextSlots } from '../api/matching'
import { demandesKeys } from './keys'

/** The matching panel of a request (D4); read again with the request (its key is the record's child). */
export function useDemandeMatch(demandeId: string, enabled = true) {
  return useQuery({ queryKey: demandesKeys.matching(demandeId), queryFn: () => fetchDemandeMatch(demandeId), enabled })
}

/** The eligible professionals' next free slot (D-48); read with the request, only with the agenda's right. */
export function useNextSlots(demandeId: string, enabled = true) {
  return useQuery({ queryKey: demandesKeys.nextSlots(demandeId), queryFn: () => fetchNextSlots(demandeId), enabled })
}

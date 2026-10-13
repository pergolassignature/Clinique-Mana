import { useQuery } from '@tanstack/react-query'
import { fetchDemandeMatch } from '../api/matching'
import { demandesKeys } from './keys'

/** The matching panel of a request (D4); read again with the request (its key is the record's child). */
export function useDemandeMatch(demandeId: string, enabled = true) {
  return useQuery({ queryKey: demandesKeys.matching(demandeId), queryFn: () => fetchDemandeMatch(demandeId), enabled })
}

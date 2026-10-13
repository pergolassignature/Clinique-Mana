import { useInfiniteQuery } from '@tanstack/react-query'
import { fetchClientVisits, VISITS_PAGE } from '../api/visits'
import { appointmentsKeys } from './keys'

/** A client's appointments, newest first, paged on the start (`list_client_visits`). */
export function useClientVisits(clientId: string) {
  return useInfiniteQuery({
    queryKey: appointmentsKeys.clientVisits(clientId),
    queryFn: ({ pageParam }) => fetchClientVisits(clientId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.length === VISITS_PAGE ? (last.at(-1)?.startsAt ?? null) : null),
    enabled: clientId !== '',
  })
}

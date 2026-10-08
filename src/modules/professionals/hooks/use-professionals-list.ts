import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { fetchProfessionalsList, fetchProfessionalsPage, PROFESSIONALS_PAGE_SIZE, type ProfessionalsPageQuery } from '../api/list'
import type { ProfessionalListRow } from '../api/parse'
import { professionalKeys } from './keys'

/**
 * The whole list (≤ 500 rows) for the list page, which filters it in the browser
 * (`filterProfessionals`, URL filters). Run it in parallel with `useProfessionalsCatalog`.
 */
export function useProfessionalsList() {
  return useQuery({ queryKey: professionalKeys.list(), queryFn: fetchProfessionalsList })
}

/**
 * The list paged on the server (keyset): each page starts after the previous page's last row. A
 * full page means there may be more. Each query (filters + sort) is its own cache entry.
 */
export function useProfessionalsPages(query: ProfessionalsPageQuery) {
  return useInfiniteQuery({
    queryKey: professionalKeys.pages(query),
    queryFn: ({ pageParam }) => fetchProfessionalsPage(query, pageParam),
    initialPageParam: null as ProfessionalListRow | null,
    getNextPageParam: (lastPage) => (lastPage.length === PROFESSIONALS_PAGE_SIZE ? lastPage.at(-1) : undefined),
  })
}

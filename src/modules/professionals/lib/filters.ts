import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MAX_SET_SIZE, PAGE_SIZE, PROFESSIONAL_STATUSES, type ProfessionalStatus } from './constants'
import type { CatalogView } from './catalog-view'
import { watchFlags } from './watch'
import type { ProfessionalListRow } from '../api/parse'

/**
 * The list's filters, with the URL as the source of truth (PS Hub `useCrmUrlState`): a reload, a
 * shared link or Back shows the same rows. Parameters are French: `q`, `statut`, `profession`,
 * `langue`, `clientele`, `motif` (repeatable), `nouveaux=1`, `surveiller=1`, `page`. Unknown or
 * malformed values fall back to the defaults; ids the catalogue does not know are ignored when
 * filtering (a stale link shows everyone rather than no one).
 */
export interface ProfessionalsFilters {
  q: string
  status: ProfessionalStatus | null
  /** The primary title (the list row carries only that one). */
  titleId: string | null
  languageId: string | null
  clienteleId: string | null
  /** Any of them. */
  motifIds: string[]
  acceptingNewClients: boolean
  /** « À surveiller »: at least one watch flag. */
  watch: boolean
  /** 1-based. */
  page: number
}

export const DEFAULT_FILTERS: ProfessionalsFilters = {
  q: '',
  status: null,
  titleId: null,
  languageId: null,
  clienteleId: null,
  motifIds: [],
  acceptingNewClients: false,
  watch: false,
  page: 1,
}

/** The search field's limit (and the URL's). */
export const SEARCH_MAX_LENGTH = 280

/** The statuses as URL values (French, like the routes). */
const STATUS_PARAMS: Readonly<Record<ProfessionalStatus, string>> = {
  draft: 'a-inviter',
  invited: 'invite',
  in_review: 'a-reviser',
  active: 'actif',
  inactive: 'inactif',
}
const STATUS_BY_PARAM = new Map(PROFESSIONAL_STATUSES.map((s) => [STATUS_PARAMS[s], s]))

const PARAMS = ['q', 'statut', 'profession', 'langue', 'clientele', 'motif', 'nouveaux', 'surveiller', 'page'] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const idParam = (value: string | null) => (value !== null && UUID.test(value) ? value.toLowerCase() : null)

/** Pure: the filters a query string describes. */
export function parseProfessionalsFilters(params: URLSearchParams): ProfessionalsFilters {
  const page = Number(params.get('page'))
  const motifIds = [...new Set(params.getAll('motif').map(idParam))].filter((id): id is string => id !== null)
  return {
    q: (params.get('q') ?? '').slice(0, SEARCH_MAX_LENGTH),
    status: STATUS_BY_PARAM.get(params.get('statut') ?? '') ?? null,
    titleId: idParam(params.get('profession')),
    languageId: idParam(params.get('langue')),
    clienteleId: idParam(params.get('clientele')),
    motifIds: motifIds.slice(0, MAX_SET_SIZE),
    acceptingNewClients: params.get('nouveaux') === '1',
    watch: params.get('surveiller') === '1',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  }
}

/** Pure: the query string of `filters`, defaults left out; parameters it does not own are kept from `base`. */
export function filtersToSearchParams(filters: ProfessionalsFilters, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const params = new URLSearchParams(base)
  for (const name of PARAMS) params.delete(name)
  if (filters.q !== '') params.set('q', filters.q)
  if (filters.status) params.set('statut', STATUS_PARAMS[filters.status])
  if (filters.titleId) params.set('profession', filters.titleId)
  if (filters.languageId) params.set('langue', filters.languageId)
  if (filters.clienteleId) params.set('clientele', filters.clienteleId)
  for (const id of filters.motifIds) params.append('motif', id)
  if (filters.acceptingNewClients) params.set('nouveaux', '1')
  if (filters.watch) params.set('surveiller', '1')
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

/** Whether nothing narrows the list (the page aside): « Réinitialiser » shows otherwise. */
export function isDefaultFilters(filters: ProfessionalsFilters): boolean {
  return filtersToSearchParams({ ...filters, page: 1 }).toString() === ''
}

/**
 * The URL's filters and their setters. A filter change goes back to page 1 and replaces the
 * history entry (typing must not stack entries); a page change pushes one, so Back returns to the
 * previous page.
 */
export function useProfessionalsFilters() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseProfessionalsFilters(searchParams), [searchParams])

  const write = useCallback(
    (next: ProfessionalsFilters, replace: boolean) => setSearchParams((current) => filtersToSearchParams(next, current), { replace }),
    [setSearchParams],
  )
  const setFilters = useCallback(
    (patch: Partial<Omit<ProfessionalsFilters, 'page'>>) => write({ ...filters, ...patch, page: 1 }, true),
    [filters, write],
  )
  const toggleMotif = useCallback(
    (id: string) => setFilters({ motifIds: filters.motifIds.includes(id) ? filters.motifIds.filter((m) => m !== id) : [...filters.motifIds, id] }),
    [filters.motifIds, setFilters],
  )
  const setPage = useCallback((page: number) => write({ ...filters, page }, false), [filters, write])
  const reset = useCallback(() => write(DEFAULT_FILTERS, true), [write])

  return { filters, setFilters, toggleMotif, setPage, reset }
}

/** Lower case without accents (NFD, combining marks removed): « Hélène » matches « helene ». */
export function foldSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-CA')
}

/** A known id, else null (no filter). */
const known = (id: string | null, map: ReadonlyMap<string, unknown>) => (id !== null && map.has(id) ? id : null)

/**
 * Pure: the rows that pass every filter (« and »). The search splits on spaces; each word must
 * appear in the name (either order), the email or the primary licence.
 */
export function filterProfessionals(rows: readonly ProfessionalListRow[], filters: ProfessionalsFilters, catalog: CatalogView): ProfessionalListRow[] {
  const words = foldSearch(filters.q).split(/\s+/).filter(Boolean)
  const titleId = known(filters.titleId, catalog.byId.titles)
  const languageId = known(filters.languageId, catalog.byId.languages)
  const clienteleId = known(filters.clienteleId, catalog.byId.clienteles)
  const motifIds = filters.motifIds.filter((id) => catalog.byId.motifs.has(id))

  return rows.filter((row) => {
    if (filters.status && row.status !== filters.status) return false
    if (titleId && row.primaryTitleId !== titleId) return false
    if (languageId && !row.languageIds.includes(languageId)) return false
    if (clienteleId && !row.clienteleIds.includes(clienteleId)) return false
    if (motifIds.length > 0 && !motifIds.some((id) => row.motifIds.includes(id))) return false
    if (filters.acceptingNewClients && !row.acceptingNewClients) return false
    if (filters.watch && watchFlags(row).length === 0) return false
    if (words.length === 0) return true
    const haystack = foldSearch(`${row.firstName} ${row.lastName} ${row.email} ${row.primaryLicenceNumber ?? ''}`)
    return words.every((word) => haystack.includes(word))
  })
}

/** One page of `rows` (PAGE_SIZE), the page clamped to the last one; an empty list is one page. */
export function paginate<T>(rows: readonly T[], page: number): { rows: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(Math.max(1, page), pageCount)
  return { rows: rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), page: current, pageCount }
}

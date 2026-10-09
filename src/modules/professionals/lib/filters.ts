import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { foldSearch } from '@/shared/lib/list-search'
import { DISPLAY_STATUSES, MAX_SET_SIZE, PAGE_SIZE, type DisplayStatus } from './constants'
import type { CatalogView } from './catalog-view'
import { displayStatus } from './onboarding'
import { watchFlags } from './watch'
import type { Onboarding, ProfessionalListRow } from '../api/parse'

/**
 * The list's filters, with the URL as the source of truth (PS Hub `useCrmUrlState`): a reload, a
 * shared link or Back shows the same rows. Parameters are French: `q`, `statut`, `profession`,
 * `langue`, `clientele`, `motif` (repeatable), `nouveaux=1`, `surveiller=1`,
 * `documents=incomplets`, `page`. Unknown or
 * malformed values fall back to the defaults; ids the catalogue does not know are ignored when
 * filtering (a stale link shows everyone rather than no one).
 */
export interface ProfessionalsFilters {
  q: string
  /** As staff read it (P4-43): « À réviser » and « En préparation » are both stored `in_review`. */
  status: DisplayStatus | null
  /** The primary title (the list row carries only that one). */
  titleId: string | null
  languageId: string | null
  clienteleId: string | null
  /** Any of them. */
  motifIds: string[]
  acceptingNewClients: boolean
  /** « À surveiller »: at least one watch flag. */
  watch: boolean
  /** « Documents incomplets »: fewer required documents in order than required (`hasMissingDocuments`). */
  documentsIncomplete: boolean
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
  documentsIncomplete: false,
  page: 1,
}

/** The search field's limit (and the URL's). */
export const SEARCH_MAX_LENGTH = 280

/** The statuses as URL values (French, like the routes). */
const STATUS_PARAMS: Readonly<Record<DisplayStatus, string>> = {
  draft: 'a-inviter',
  invited: 'invite',
  in_review: 'a-reviser',
  preparing: 'en-preparation',
  active: 'actif',
  inactive: 'inactif',
}
const STATUS_BY_PARAM = new Map(DISPLAY_STATUSES.map((s) => [STATUS_PARAMS[s], s]))

const PARAMS = ['q', 'statut', 'profession', 'langue', 'clientele', 'motif', 'nouveaux', 'surveiller', 'documents', 'page'] as const

/** The value of `documents` for « Documents incomplets ». */
const DOCUMENTS_INCOMPLETE = 'incomplets'

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
    documentsIncomplete: params.get('documents') === DOCUMENTS_INCOMPLETE,
    page: Number.isInteger(page) && page > 1 ? page : 1,
  }
}

/** Pure: the query string of `filters`, defaults left out; parameters it does not own are kept from `base`. */
export function filtersToSearchParams(filters: ProfessionalsFilters, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const params = new URLSearchParams(base)
  for (const name of PARAMS) params.delete(name)
  if (filters.q.trim() !== '') params.set('q', filters.q)
  if (filters.status) params.set('statut', STATUS_PARAMS[filters.status])
  if (filters.titleId) params.set('profession', filters.titleId)
  if (filters.languageId) params.set('langue', filters.languageId)
  if (filters.clienteleId) params.set('clientele', filters.clienteleId)
  for (const id of filters.motifIds) params.append('motif', id)
  if (filters.acceptingNewClients) params.set('nouveaux', '1')
  if (filters.watch) params.set('surveiller', '1')
  if (filters.documentsIncomplete) params.set('documents', DOCUMENTS_INCOMPLETE)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

/** Whether nothing narrows the list (the page aside; spaces alone are no search): « Réinitialiser » shows otherwise. */
export function isDefaultFilters(filters: ProfessionalsFilters): boolean {
  return filtersToSearchParams({ ...filters, page: 1 }).toString() === ''
}

/** A filter change: replaces the history entry (typing must not stack entries) and is the person's choice. */
const CHOSEN = { replace: true, chosen: true } as const

/**
 * The URL's filters and their setters. A filter change goes back to page 1 and replaces the
 * history entry (typing must not stack entries); a page change pushes one, so Back returns to the
 * previous page.
 *
 * Each setter computes the next filters from the current URL, not from the filters of the last
 * render, so two changes in one event (or a setter held by an older closure) both apply. The
 * current URL is `latest`, not `setSearchParams`'s updater argument: react-router 6 hands that
 * updater the search params of its last render, so a second call in the same tick would undo the
 * first. `latest` follows every render (Back, links) and every write made here.
 *
 * `onChange` hears the filters a person chose (`setFilters`, `toggleMotif`, `reset`), not a page
 * change, a link, Back, or `restore`: what the list remembers for them (4a.10).
 */
export function useProfessionalsFilters({ onChange }: { onChange?: (filters: ProfessionalsFilters) => void } = {}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseProfessionalsFilters(searchParams), [searchParams])
  const latest = useRef(searchParams)
  const changed = useRef(onChange)
  useLayoutEffect(() => {
    latest.current = searchParams
    changed.current = onChange
  }, [searchParams, onChange])

  const update = useCallback(
    (change: (current: ProfessionalsFilters) => ProfessionalsFilters, { replace, chosen }: { replace: boolean; chosen: boolean }) => {
      const nextFilters = change(parseProfessionalsFilters(latest.current))
      const next = filtersToSearchParams(nextFilters, latest.current)
      latest.current = next
      setSearchParams(next, { replace })
      if (chosen) changed.current?.(nextFilters)
    },
    [setSearchParams],
  )
  const setFilters = useCallback(
    (patch: Partial<Omit<ProfessionalsFilters, 'page'>>) => update((current) => ({ ...current, ...patch, page: 1 }), CHOSEN),
    [update],
  )
  const toggleMotif = useCallback(
    (id: string) =>
      update(
        (current) => ({
          ...current,
          motifIds: current.motifIds.includes(id) ? current.motifIds.filter((m) => m !== id) : [...current.motifIds, id],
          page: 1,
        }),
        CHOSEN,
      ),
    [update],
  )
  const setPage = useCallback((page: number) => update((current) => ({ ...current, page }), { replace: false, chosen: false }), [update])
  const reset = useCallback(() => update(() => DEFAULT_FILTERS, CHOSEN), [update])
  /** Puts saved filters in the URL (page 1), replacing the entry; `onChange` is not called. */
  const restore = useCallback((saved: ProfessionalsFilters) => update(() => ({ ...saved, page: 1 }), { replace: true, chosen: false }), [update])

  return { filters, setFilters, toggleMotif, setPage, reset, restore }
}

/** Whether some required document is not in order yet (none required: nothing is missing). */
export function hasMissingDocuments(row: Pick<ProfessionalListRow, 'documentsDone' | 'documentsRequired'>): boolean {
  return row.documentsRequired > 0 && row.documentsDone < row.documentsRequired
}

/** A known id, else null (no filter). */
const known = (id: string | null, map: ReadonlyMap<string, unknown>) => (id !== null && map.has(id) ? id : null)

/** The folded text the search looks in, per row: built once per list (`useMemo` on the rows), not per keystroke. */
type SearchHaystacks = ReadonlyMap<ProfessionalListRow, string>

/** Pure: each row's name (either order), email and primary licence, folded (accents and case ignored). */
export function searchHaystacks(rows: readonly ProfessionalListRow[]): SearchHaystacks {
  return new Map(rows.map((row) => [row, foldSearch(`${row.firstName} ${row.lastName} ${row.email} ${row.primaryLicenceNumber ?? ''}`)]))
}

/**
 * Pure: the rows that pass every filter (« and »). The search splits on spaces; each word must
 * appear in the name (either order), the email or the primary licence. `haystacks` is
 * `searchHaystacks(rows)`, passed in so the folding is not redone on each change.
 */
export function filterProfessionals(
  rows: readonly ProfessionalListRow[],
  filters: ProfessionalsFilters,
  catalog: CatalogView,
  haystacks: SearchHaystacks = searchHaystacks(rows),
): ProfessionalListRow[] {
  const words = foldSearch(filters.q).split(/\s+/).filter(Boolean)
  const titleId = known(filters.titleId, catalog.byId.titles)
  const languageId = known(filters.languageId, catalog.byId.languages)
  const clienteleId = known(filters.clienteleId, catalog.byId.clienteles)
  const motifIds = filters.motifIds.filter((id) => catalog.byId.motifs.has(id))

  return rows.filter((row) => {
    if (filters.status && displayStatus(row.status, row.onboarding) !== filters.status) return false
    if (titleId && row.primaryTitleId !== titleId) return false
    if (languageId && !row.languageIds.includes(languageId)) return false
    if (clienteleId && !row.clienteleIds.includes(clienteleId)) return false
    if (motifIds.length > 0 && !motifIds.some((id) => row.motifIds.includes(id))) return false
    if (filters.acceptingNewClients && !row.acceptingNewClients) return false
    if (filters.watch && watchFlags(row).length === 0) return false
    if (filters.documentsIncomplete && !hasMissingDocuments(row)) return false
    if (words.length === 0) return true
    const haystack = haystacks.get(row) ?? ''
    return words.every((word) => haystack.includes(word))
  })
}

/**
 * The rows with their onboarding (`list_professional_invitation_states`, one request for the
 * clinic, P4-270), joined in memory; a file without link or submission has none.
 */
export function withOnboarding(rows: readonly ProfessionalListRow[], states: ReadonlyMap<string, Onboarding>): ProfessionalListRow[] {
  return rows.map((row) => ({ ...row, onboarding: states.get(row.id) ?? null }))
}

/** One page of `rows` (PAGE_SIZE), the page clamped to the last one; an empty list is one page. */
export function paginate<T>(rows: readonly T[], page: number): { rows: T[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const current = Math.min(Math.max(1, page), pageCount)
  return { rows: rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), page: current, pageCount }
}

import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ROUTER_FUTURE } from '@/shared/lib/router-future'
import {
  DEFAULT_FILTERS,
  filterProfessionals,
  filtersToSearchParams,
  hasMissingDocuments,
  isDefaultFilters,
  paginate,
  parseProfessionalsFilters,
  SEARCH_MAX_LENGTH,
  useProfessionalsFilters,
  type ProfessionalsFilters,
} from './filters'
import { PAGE_SIZE } from './constants'
import { CATALOG_VIEW, listRowFixture } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'

const parse = (query: string) => parseProfessionalsFilters(new URLSearchParams(query))
const filters = (overrides: Partial<ProfessionalsFilters> = {}): ProfessionalsFilters => ({ ...DEFAULT_FILTERS, ...overrides })

describe('parseProfessionalsFilters', () => {
  it('reads every filter from the URL', () => {
    expect(
      parse(`q=marie&statut=actif&profession=${IDS.psychologue}&langue=${IDS.en}&clientele=${IDS.couples}&motif=${IDS.anxiete}&motif=${IDS.deuil}&nouveaux=1&surveiller=1&documents=incomplets&page=3`),
    ).toEqual({
      q: 'marie',
      status: 'active',
      titleId: IDS.psychologue,
      languageId: IDS.en,
      clienteleId: IDS.couples,
      motifIds: [IDS.anxiete, IDS.deuil],
      acceptingNewClients: true,
      watch: true,
      documentsIncomplete: true,
      page: 3,
    })
  })

  it('falls back to the defaults for unknown or malformed values', () => {
    expect(parse('statut=pending&profession=psychologue&langue=&motif=x&motif=x&nouveaux=oui&surveiller=0&documents=1&page=-2')).toEqual(DEFAULT_FILTERS)
    expect(parse('page=abc').page).toBe(1)
    expect(parse('page=2.5').page).toBe(1)
  })

  it('keeps each motif once and caps the search', () => {
    expect(parse(`motif=${IDS.anxiete}&motif=${IDS.anxiete}`).motifIds).toEqual([IDS.anxiete])
    expect(parse(`q=${'a'.repeat(400)}`).q).toHaveLength(SEARCH_MAX_LENGTH)
  })

  it('maps every status to its French URL value', () => {
    expect(['a-inviter', 'invite', 'a-reviser', 'actif', 'inactif'].map((s) => parse(`statut=${s}`).status)).toEqual(['draft', 'invited', 'in_review', 'active', 'inactive'])
  })
})

describe('filtersToSearchParams', () => {
  it('round-trips, leaving defaults out', () => {
    const value = filters({ q: 'é', status: 'in_review', motifIds: [IDS.anxiete, IDS.deuil], acceptingNewClients: true, documentsIncomplete: true, page: 2 })
    const params = filtersToSearchParams(value)
    expect(params.toString()).toBe(`q=%C3%A9&statut=a-reviser&motif=${IDS.anxiete}&motif=${IDS.deuil}&nouveaux=1&documents=incomplets&page=2`)
    expect(parseProfessionalsFilters(params)).toEqual(value)
    expect(filtersToSearchParams(DEFAULT_FILTERS).toString()).toBe('')
  })

  it('writes no search made of spaces alone, and keeps a real one as typed', () => {
    expect(filtersToSearchParams(filters({ q: '   ' })).toString()).toBe('')
    expect(filtersToSearchParams(filters({ q: 'marie ' })).get('q')).toBe('marie ')
  })

  it('keeps the parameters it does not own', () => {
    expect(filtersToSearchParams(filters({ watch: true }), new URLSearchParams('x=1&statut=actif')).toString()).toBe('x=1&surveiller=1')
  })
})

describe('isDefaultFilters', () => {
  it('ignores the page', () => {
    expect(isDefaultFilters(filters({ page: 4 }))).toBe(true)
    expect(isDefaultFilters(filters({ q: ' ' }))).toBe(true)
    expect(isDefaultFilters(filters({ q: ' a' }))).toBe(false)
    expect(isDefaultFilters(filters({ motifIds: [IDS.anxiete] }))).toBe(false)
  })
})

describe('filterProfessionals', () => {
  const marie = listRowFixture()
  const helene = listRowFixture({
    id: 'p2',
    firstName: 'Hélène',
    lastName: 'Côté',
    email: 'hcote@exemple.ca',
    status: 'active',
    primaryTitleId: IDS.naturopathe,
    primaryLicenceNumber: null,
    languageIds: [IDS.fr, IDS.en],
    clienteleIds: [IDS.children],
    motifIds: [IDS.deuil, IDS.psychose],
    acceptingNewClients: false,
    matchingComplete: false,
  })
  const rows = [marie, helene]
  const ids = (f: Partial<ProfessionalsFilters>) => filterProfessionals(rows, filters(f), CATALOG_VIEW).map((r) => r.id)

  it('keeps everyone without filters', () => {
    expect(ids({})).toEqual([marie.id, 'p2'])
  })

  it('searches name (either order), email and licence, accents and case ignored, every word', () => {
    expect(ids({ q: 'helene' })).toEqual(['p2'])
    expect(ids({ q: 'COTE hel' })).toEqual(['p2'])
    expect(ids({ q: 'tremblay marie' })).toEqual([marie.id])
    expect(ids({ q: 'hcote@' })).toEqual(['p2'])
    expect(ids({ q: '12345' })).toEqual([marie.id])
    expect(ids({ q: 'marie côté' })).toEqual([])
    expect(ids({ q: '   ' })).toEqual([marie.id, 'p2'])
  })

  it('filters by status, primary title, language, clientèle and any of the motifs', () => {
    expect(ids({ status: 'active' })).toEqual(['p2'])
    expect(ids({ titleId: IDS.psychologue })).toEqual([marie.id])
    expect(ids({ languageId: IDS.en })).toEqual(['p2'])
    expect(ids({ clienteleId: IDS.couples })).toEqual([marie.id])
    expect(ids({ motifIds: [IDS.anxiete, IDS.psychose] })).toEqual([marie.id, 'p2'])
    expect(ids({ motifIds: [IDS.deuil] })).toEqual(['p2'])
  })

  it('filters on new clients and on « À surveiller »', () => {
    expect(ids({ acceptingNewClients: true })).toEqual([marie.id])
    expect(ids({ watch: true })).toEqual(['p2'])
  })

  it('filters on « Documents incomplets »: some required document not in order; none required is complete', () => {
    const counts = (documentsDone: number, documentsRequired: number, id: string) => listRowFixture({ id, documentsDone, documentsRequired })
    const docs = [counts(2, 3, 'missing'), counts(3, 3, 'complete'), counts(0, 0, 'none'), counts(0, 1, 'empty')]
    expect(filterProfessionals(docs, filters({ documentsIncomplete: true }), CATALOG_VIEW).map((r) => r.id)).toEqual(['missing', 'empty'])
    expect(hasMissingDocuments({ documentsDone: 3, documentsRequired: 3 })).toBe(false)
  })

  it('combines filters with « and »', () => {
    expect(ids({ languageId: IDS.fr, acceptingNewClients: true })).toEqual([marie.id])
    expect(ids({ status: 'active', titleId: IDS.psychologue })).toEqual([])
  })

  it('ignores ids the catalogue does not know (stale links)', () => {
    expect(ids({ titleId: '00000000-0000-4000-8000-00000000ffff', motifIds: ['00000000-0000-4000-8000-00000000fffe'] })).toEqual([marie.id, 'p2'])
  })
})

describe('paginate', () => {
  const rows = Array.from({ length: PAGE_SIZE * 2 + 3 }, (_, i) => i)

  it('cuts pages of PAGE_SIZE and counts them', () => {
    expect(paginate(rows, 1)).toEqual({ rows: rows.slice(0, PAGE_SIZE), page: 1, pageCount: 3 })
    expect(paginate(rows, 3).rows).toEqual(rows.slice(PAGE_SIZE * 2))
  })

  it('clamps a page past the end, and counts one page when empty', () => {
    expect(paginate(rows, 9).page).toBe(3)
    expect(paginate([], 2)).toEqual({ rows: [], page: 1, pageCount: 1 })
  })
})

describe('useProfessionalsFilters', () => {
  function setup(initial: string, onChange?: (filters: ProfessionalsFilters) => void) {
    let location = { search: '', key: '' }
    function Probe() {
      const l = useLocation()
      location = { search: l.search, key: l.key }
      return null
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[`/professionnels${initial}`]} future={ROUTER_FUTURE}>
        {children}
        <Probe />
      </MemoryRouter>
    )
    const hook = renderHook(() => useProfessionalsFilters({ onChange }), { wrapper })
    return { hook, location: () => location }
  }

  it('reads the URL', () => {
    const { hook } = setup('?statut=inactif&page=2')
    expect(hook.result.current.filters).toMatchObject({ status: 'inactive', page: 2 })
  })

  it('writes a filter change to the URL and goes back to page 1', () => {
    const { hook, location } = setup('?page=3&x=1')
    act(() => hook.result.current.setFilters({ q: 'marie' }))
    expect(location().search).toBe('?x=1&q=marie')
    expect(hook.result.current.filters).toMatchObject({ q: 'marie', page: 1 })
  })

  it('applies two changes made in the same event, each from the URL the previous one wrote', () => {
    const { hook, location } = setup('?page=2')
    act(() => {
      hook.result.current.setFilters({ q: 'marie' })
      hook.result.current.toggleMotif(IDS.anxiete)
      hook.result.current.toggleMotif(IDS.deuil)
    })
    expect(location().search).toBe(`?q=marie&motif=${IDS.anxiete}&motif=${IDS.deuil}`)
  })

  it('a setter kept from an older render still starts from the current URL', () => {
    const { hook, location } = setup('')
    const { setFilters } = hook.result.current
    act(() => hook.result.current.toggleMotif(IDS.anxiete))
    act(() => setFilters({ watch: true }))
    expect(location().search).toBe(`?motif=${IDS.anxiete}&surveiller=1`)
  })

  it('toggles a motif in and out', () => {
    const { hook, location } = setup('')
    act(() => hook.result.current.toggleMotif(IDS.anxiete))
    expect(location().search).toBe(`?motif=${IDS.anxiete}`)
    act(() => hook.result.current.toggleMotif(IDS.anxiete))
    expect(location().search).toBe('')
  })

  it('changes the page, and resets every filter', () => {
    const { hook, location } = setup('?surveiller=1')
    act(() => hook.result.current.setPage(2))
    expect(location().search).toBe('?surveiller=1&page=2')
    act(() => hook.result.current.reset())
    expect(location().search).toBe('')
  })

  it('tells onChange the filters a person chose, never a page change', () => {
    const onChange = vi.fn()
    const { hook } = setup('?statut=actif', onChange)
    act(() => hook.result.current.setFilters({ q: 'marie' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, q: 'marie', status: 'active' })
    act(() => hook.result.current.toggleMotif(IDS.anxiete))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, q: 'marie', status: 'active', motifIds: [IDS.anxiete] })
    act(() => hook.result.current.reset())
    expect(onChange).toHaveBeenLastCalledWith(DEFAULT_FILTERS)
    onChange.mockClear()
    act(() => hook.result.current.setPage(2))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('restores saved filters on page 1, replacing the entry, without telling onChange', () => {
    const onChange = vi.fn()
    const { hook, location } = setup('?page=4', onChange)
    const before = location().key
    act(() => hook.result.current.restore({ ...DEFAULT_FILTERS, status: 'inactive', page: 3 }))
    expect(location().search).toBe('?statut=inactif')
    expect(location().key).not.toBe(before)
    expect(onChange).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchProfessionalsCatalog,
  fetchReferenceUsage,
  referenceRows,
  reorderedCatalog,
  reorderReference,
  saveReference,
  setReferenceActive,
  usageKey,
  type ReferenceInput,
  type ReferenceKind,
} from './catalog'
import { parseRpc, catalogPayload, UNEXPECTED_SHAPE } from './parse'
import { CATALOG_JSON, IDS } from '../test/fixtures'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))

afterEach(() => vi.clearAllMocks())

const ok = (data: unknown) => mocks.rpc.mockResolvedValue({ data, error: null })

describe('fetchProfessionalsCatalog', () => {
  it('reads the nine lists in one call', async () => {
    ok(CATALOG_JSON)
    const catalog = await fetchProfessionalsCatalog()
    expect(mocks.rpc).toHaveBeenCalledWith('get_professionals_catalog')
    expect(catalog.motifs.map((m) => m.key)).toEqual(['anxiete', 'deuil', 'psychose', 'sans_categorie', 'ancien_motif'])
  })

  it('throws the RPC error unchanged', async () => {
    const error = { code: '57014', message: 'canceling statement due to statement timeout' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchProfessionalsCatalog()).rejects.toBe(error)
  })

  it('throws the shape error on an unexpected payload', async () => {
    ok({ orders: [] })
    await expect(fetchProfessionalsCatalog()).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

describe('fetchReferenceUsage', () => {
  it('maps the counts by kind and id', async () => {
    ok([
      { kind: 'motifs', id: IDS.anxiete, usage: 3 },
      { kind: 'profession_categories', id: IDS.psychologie, usage: 2 },
    ])
    const usage = await fetchReferenceUsage()
    expect(mocks.rpc).toHaveBeenCalledWith('list_professionals_reference_usage')
    expect(usage.get(usageKey('motifs', IDS.anxiete))).toBe(3)
    expect(usage.get(usageKey('profession_categories', IDS.psychologie))).toBe(2)
    expect(usage.get(usageKey('motifs', IDS.deuil))).toBeUndefined()
  })

  it('throws the refusal of a caller without professionals.settings or .manage', async () => {
    const error = { code: '42501', message: 'Permission refusée' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchReferenceUsage()).rejects.toBe(error)
  })
})

describe('referenceRows', () => {
  it('returns the catalogue list of each kind', () => {
    const catalog = parseRpc(catalogPayload, CATALOG_JSON)
    expect(referenceRows(catalog, 'professional_orders')).toBe(catalog.orders)
    expect(referenceRows(catalog, 'profession_categories')).toBe(catalog.categories)
    expect(referenceRows(catalog, 'profession_titles')).toBe(catalog.titles)
    expect(referenceRows(catalog, 'motif_categories')).toBe(catalog.motifCategories)
    expect(referenceRows(catalog, 'deactivation_reasons')).toBe(catalog.deactivationReasons)
    expect(referenceRows(catalog, 'languages')[0]?.code).toBe('fr')
  })
})

describe('saveReference', () => {
  const cases: { [K in ReferenceKind]: [ReferenceInput<K>, string, Record<string, unknown>] } = {
    professional_orders: [
      { id: null, name: 'Ordre des psychologues', acronym: 'OPQ', licenceLabel: null, licencePattern: null },
      'save_professional_order',
      { p_id: null, p_name: 'Ordre des psychologues', p_acronym: 'OPQ', p_licence_label: null, p_licence_pattern: null },
    ],
    profession_categories: [{ id: IDS.psychologie, name: 'Psychologie' }, 'save_profession_category', { p_id: IDS.psychologie, p_name: 'Psychologie' }],
    profession_titles: [
      { id: null, name: 'Psychologue', categoryId: IDS.psychologie, orderId: null },
      'save_profession_title',
      { p_id: null, p_name: 'Psychologue', p_category_id: IDS.psychologie, p_order_id: null },
    ],
    clienteles: [
      { id: null, name: 'Aînés', minAge: 65, maxAge: null },
      'save_clientele',
      { p_id: null, p_name: 'Aînés', p_min_age: 65, p_max_age: null },
    ],
    motif_categories: [
      { id: null, name: 'Vie intérieure', description: null, icon: 'Brain' },
      'save_motif_category',
      { p_id: null, p_name: 'Vie intérieure', p_description: null, p_icon: 'Brain' },
    ],
    motifs: [
      { id: null, name: 'Proche aidance', categoryId: null, isRestricted: false },
      'save_motif',
      { p_id: null, p_name: 'Proche aidance', p_category_id: null, p_is_restricted: false },
    ],
    languages: [{ id: null, name: 'Portugais', code: 'pt' }, 'save_language', { p_id: null, p_name: 'Portugais', p_code: 'pt' }],
    deactivation_reasons: [
      { id: null, name: 'Congé', requiresNote: false, disablesAccount: true },
      'save_deactivation_reason',
      { p_id: null, p_name: 'Congé', p_requires_note: false, p_disables_account: true },
    ],
  }

  for (const [kind, [input, fn, args]] of Object.entries(cases) as [ReferenceKind, [ReferenceInput<ReferenceKind>, string, Record<string, unknown>]][]) {
    it(`${kind}: calls ${fn} (null id on create) and returns the id`, async () => {
      ok('new-id')
      await expect(saveReference(kind, input)).resolves.toBe('new-id')
      expect(mocks.rpc).toHaveBeenCalledWith(fn, args)
    })
  }

  it('throws the French refusal unchanged', async () => {
    const error = { code: 'P0001', message: 'Un motif porte déjà ce nom (il est peut-être archivé).' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(saveReference('motifs', { id: null, name: 'Anxiété', categoryId: null, isRestricted: false })).rejects.toBe(error)
  })
})

describe('setReferenceActive', () => {
  it('archives or restores one row', async () => {
    ok(null)
    await setReferenceActive('motifs', IDS.anxiete, false)
    expect(mocks.rpc).toHaveBeenCalledWith('set_professionals_reference_active', { p_kind: 'motifs', p_id: IDS.anxiete, p_active: false })
  })

  it('throws the refusal', async () => {
    const error = { code: 'P0001', message: 'Archivez d’abord les titres de cette catégorie.' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(setReferenceActive('profession_categories', IDS.psychologie, false)).rejects.toBe(error)
  })
})

describe('reorderReference', () => {
  it('sends the full list in its new order', async () => {
    ok(null)
    await reorderReference('motif_categories', [IDS.archivedCategory, IDS.innerLife])
    expect(mocks.rpc).toHaveBeenCalledWith('reorder_professionals_reference', { p_kind: 'motif_categories', p_ids: [IDS.archivedCategory, IDS.innerLife] })
  })
})

describe('reorderedCatalog', () => {
  const catalog = parseRpc(catalogPayload, CATALOG_JSON)

  it('puts one list in the new order with the sort orders the RPC gives, leaving the others alone', () => {
    const next = reorderedCatalog(catalog, 'motif_categories', [IDS.archivedCategory, IDS.innerLife])
    expect(next.motifCategories.map((c) => [c.id, c.sortOrder])).toEqual([
      [IDS.archivedCategory, 10],
      [IDS.innerLife, 20],
    ])
    expect(next.motifs).toBe(catalog.motifs)
    expect(catalog.motifCategories[0]?.id).toBe(IDS.innerLife)
  })

  it('keeps rows missing from the ids at the end', () => {
    const next = reorderedCatalog(catalog, 'languages', [IDS.en])
    expect(next.languages.map((l) => [l.code, l.sortOrder])).toEqual([
      ['en', 10],
      ['fr', 10],
    ])
  })
})

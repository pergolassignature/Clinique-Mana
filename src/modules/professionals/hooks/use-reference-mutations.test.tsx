import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { t } from '@/i18n'
import { useReorderReference, useSaveReference, useSetReferenceActive } from './use-reference-mutations'
import { professionalCatalogKeys, professionalKeys } from './keys'
import { CATALOG } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import { setupQueryClient } from '../test/query-client'
import type { ProfessionalsCatalog } from '../api/parse'

const mocks = vi.hoisted(() => ({
  api: { saveReference: vi.fn(), setReferenceActive: vi.fn(), reorderReference: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/catalog')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

afterEach(() => vi.clearAllMocks())

function setup() {
  const client = setupQueryClient()
  client.queryClient.setQueryData(professionalCatalogKeys.catalog(), CATALOG)
  const cached = () => client.queryClient.getQueryData<ProfessionalsCatalog>(professionalCatalogKeys.catalog())
  return { ...client, cached }
}

describe('useSaveReference', () => {
  it('saves, refreshes the catalogue and confirms', async () => {
    const { wrapper, invalidated } = setup()
    mocks.api.saveReference.mockResolvedValue('new-id')
    const { result } = renderHook(() => useSaveReference(), { wrapper })
    result.current.mutate({ kind: 'languages', input: { id: null, name: 'Portugais', code: 'pt' } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.api.saveReference).toHaveBeenCalledWith('languages', { id: null, name: 'Portugais', code: 'pt' })
    expect(result.current.data).toBe('new-id')
    expect(invalidated()).toEqual([professionalCatalogKeys.all])
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.saved'))
  })

  it('also refreshes the records for titles and motifs (their rules change readiness)', async () => {
    const { wrapper, invalidated } = setup()
    mocks.api.saveReference.mockResolvedValue(IDS.psychose)
    const { result } = renderHook(() => useSaveReference(), { wrapper })
    result.current.mutate({ kind: 'motifs', input: { id: IDS.psychose, name: 'Psychose', categoryId: IDS.innerLife, isRestricted: true } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidated()).toEqual([professionalCatalogKeys.all, professionalKeys.all])
  })

  it('hands a refusal to the dialog', async () => {
    const { wrapper } = setup()
    const onErrorMessage = vi.fn()
    mocks.api.saveReference.mockRejectedValue({ code: 'P0001', message: 'Cette langue existe déjà.' })
    const { result } = renderHook(() => useSaveReference({ onErrorMessage }), { wrapper })
    result.current.mutate({ kind: 'languages', input: { id: null, name: 'Anglais', code: 'en' } })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(onErrorMessage).toHaveBeenCalledWith('Cette langue existe déjà.', expect.anything())
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })
})

describe('useSetReferenceActive', () => {
  it('archives, then refreshes the catalogue and the records', async () => {
    const { wrapper, invalidated } = setup()
    mocks.api.setReferenceActive.mockResolvedValue(undefined)
    const { result } = renderHook(() => useSetReferenceActive(), { wrapper })
    result.current.mutate({ kind: 'motifs', id: IDS.anxiete, active: false })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.api.setReferenceActive).toHaveBeenCalledWith('motifs', IDS.anxiete, false)
    expect(invalidated()).toEqual([professionalCatalogKeys.all, professionalKeys.all])
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.archived'))
  })

  it('says « restauré » on restore, and shows a refusal', async () => {
    const { wrapper } = setup()
    mocks.api.setReferenceActive.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useSetReferenceActive(), { wrapper })
    result.current.mutate({ kind: 'motifs', id: IDS.archivedMotif, active: true })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.restored'))

    mocks.api.setReferenceActive.mockRejectedValueOnce({ code: 'P0001', message: 'Archivez d’abord les titres de cette catégorie.' })
    result.current.mutate({ kind: 'profession_categories', id: IDS.psychologie, active: false })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(mocks.toast.error).toHaveBeenCalledWith('Archivez d’abord les titres de cette catégorie.')
  })
})

describe('useReorderReference', () => {
  it('shows the new order at once, then refreshes the catalogue', async () => {
    const { wrapper, cached, invalidated } = setup()
    let resolve: () => void = () => {}
    mocks.api.reorderReference.mockReturnValue(new Promise<void>((r) => (resolve = r)))
    const { result } = renderHook(() => useReorderReference(), { wrapper })
    result.current.mutate({ kind: 'motif_categories', ids: [IDS.archivedCategory, IDS.innerLife] })
    await waitFor(() => expect(cached()?.motifCategories.map((c) => c.id)).toEqual([IDS.archivedCategory, IDS.innerLife]))
    resolve()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.api.reorderReference).toHaveBeenCalledWith('motif_categories', [IDS.archivedCategory, IDS.innerLife])
    expect(invalidated()).toEqual([professionalCatalogKeys.catalog()])
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('rolls back on error and shows it', async () => {
    const { wrapper, cached } = setup()
    mocks.api.reorderReference.mockRejectedValue({ code: '22023', message: 'Éléments inconnus.' })
    const { result } = renderHook(() => useReorderReference(), { wrapper })
    result.current.mutate({ kind: 'motif_categories', ids: [IDS.archivedCategory, IDS.innerLife] })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(cached()?.motifCategories.map((c) => c.id)).toEqual([IDS.innerLife, IDS.archivedCategory])
    expect(mocks.toast.error).toHaveBeenCalledWith(t('modules.professionals.errors.saveFailed'))
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { IDS } from '../test/fixtures'
import { setupQueryClient } from '../test/query-client'
import { professionalCatalogKeys, professionalKeys } from './keys'
import { useApplySubmission } from './use-submissions'

const mocks = vi.hoisted(() => ({ apply: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../api/submissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/submissions')>()),
  applyProfessionalSubmission: mocks.apply,
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

afterEach(() => vi.clearAllMocks())

const SUBMISSION = '00000000-0000-4000-8000-00000000e101'

async function applyFields(fields: Parameters<ReturnType<typeof useApplySubmission>['mutateAsync']>[0]['fields'], { fail = false } = {}) {
  if (fail) mocks.apply.mockRejectedValueOnce({ code: 'P0001', message: 'Cette soumission n’attend pas de révision.', hint: 'status' })
  else mocks.apply.mockResolvedValueOnce(undefined)
  const { wrapper, invalidated } = setupQueryClient()
  const { result } = renderHook(() => useApplySubmission({ onErrorMessage: () => undefined }), { wrapper })
  await act(() => result.current.mutateAsync({ professionalId: IDS.professional, submissionId: SUBMISSION, kind: 'update', fields }).catch(() => undefined))
  return invalidated()
}

// P4-374: what an applied submission changes beyond the record (the `keys.ts` table).
describe('useApplySubmission', () => {
  it('a private field applied: the file’s masks are read again', async () => {
    const keys = await applyFields(['city', 'bank_account'])
    expect(keys).toContainEqual(professionalKeys.private(IDS.professional))
    expect(keys).not.toContainEqual(professionalCatalogKeys.usage())
    expect(keys).toEqual(expect.arrayContaining([professionalKeys.record(IDS.professional), professionalKeys.lists()]))
  })

  it('a set applied: the lists’ « Utilisé par » counts are read again', async () => {
    const keys = await applyFields(['motif_ids'])
    expect(keys).toContainEqual(professionalCatalogKeys.usage())
    expect(keys).not.toContainEqual(professionalKeys.private(IDS.professional))
  })

  it('plain fields only, or an approval without a change: neither', async () => {
    for (const fields of [['city', 'bio'], []] as const) {
      const keys = await applyFields(fields)
      expect(keys).not.toContainEqual(professionalKeys.private(IDS.professional))
      expect(keys).not.toContainEqual(professionalCatalogKeys.usage())
    }
  })

  it('a refused decision applied nothing: neither', async () => {
    const keys = await applyFields(['bank_account', 'motif_ids'], { fail: true })
    expect(keys).not.toContainEqual(professionalKeys.private(IDS.professional))
    expect(keys).not.toContainEqual(professionalCatalogKeys.usage())
  })
})

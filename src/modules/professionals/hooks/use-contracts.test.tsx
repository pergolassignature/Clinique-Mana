import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { IDS } from '../test/fixtures'
import { DRAFT_ID, REQUEST_ID } from '../test/fixtures-contract'
import { setupQueryClient } from '../test/query-client'
import { contractTemplateKeys, professionalKeys } from './keys'
import { contractErrorMessage, useSendContract, useSyncContract, useTemplateMutations } from './use-contracts'

const mocks = vi.hoisted(() => ({
  api: {
    sendProfessionalContract: vi.fn(),
    publishTemplateVersion: vi.fn(),
    updateTemplateVersion: vi.fn(),
  },
  sync: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/contracts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/contracts')>()), ...mocks.api }))
vi.mock('@/core/signing/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/core/signing/api')>()), syncSignatureRequest: mocks.sync }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

afterEach(() => vi.clearAllMocks())

const E = 'modules.professionals.contract.errors'

describe('contractErrorMessage (P3-28)', () => {
  it('says each function failure in French', () => {
    expect(contractErrorMessage(new FunctionCallError('missing_variable', 400, 'x', { label: 'Adresse du professionnel' }))).toBe(
      t(`${E}.missingVariable`, { label: 'Adresse du professionnel' }),
    )
    expect(contractErrorMessage(new FunctionCallError('missing_variable', 400, 'x'))).toBe(t(`${E}.missingVariableUnknown`))
    expect(contractErrorMessage(new FunctionCallError('not_configured', 503, 'x'))).toBe(t(`${E}.notConfigured`))
    expect(contractErrorMessage(new FunctionCallError('provider_error', 502, 'x'))).toBe(t(`${E}.providerError`))
    expect(contractErrorMessage(new FunctionCallError('conflict', 409, 'x'))).toBe(t(`${E}.inProgress`))
    expect(contractErrorMessage(new FunctionCallError('network', 0, 'x'))).toBe(t(`${E}.network`))
    expect(contractErrorMessage(new FunctionCallError('rate_limited', 429, 'x', {}, 2700))).toBe(`${t(`${E}.rateLimited`)} Réessayez dans environ 45 minutes.`)
  })

  it('leaves the refusals and anything else to showMutationError', () => {
    expect(contractErrorMessage({ code: 'P0001', message: 'Aucun modèle de contrat publié.' })).toBeNull()
    expect(contractErrorMessage(new FunctionCallError('internal', 500, 'x'))).toBeNull()
  })
})

describe('useSendContract (P4-434: one key per action until it succeeds)', () => {
  it('retries a failed action under the same key, then draws a new one after a success', async () => {
    const { wrapper, invalidated } = setupQueryClient()
    const onErrorMessage = vi.fn()
    mocks.api.sendProfessionalContract.mockRejectedValueOnce(new FunctionCallError('provider_error', 502, 'x')).mockResolvedValue(REQUEST_ID)
    const { result } = renderHook(() => useSendContract(IDS.professional, 'Marie', { onErrorMessage }), { wrapper })

    act(() => result.current.run('send'))
    await waitFor(() => expect(onErrorMessage).toHaveBeenCalledWith(t(`${E}.providerError`), expect.any(FunctionCallError)))
    act(() => result.current.run('send'))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.contract.toasts.send', { firstName: 'Marie' })))
    act(() => result.current.run('send'))
    await waitFor(() => expect(mocks.api.sendProfessionalContract).toHaveBeenCalledTimes(3))

    const keys = mocks.api.sendProfessionalContract.mock.calls.map(([, , key]) => key as string)
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[1])
    // The record (readiness, the card), the lists and the history follow.
    expect(invalidated()).toEqual(expect.arrayContaining([professionalKeys.record(IDS.professional), professionalKeys.lists(), professionalKeys.history(IDS.professional)]))
  })

  it('draws a new key after a missing value or a refusal (the first snapshot kept the empty value)', async () => {
    const { wrapper } = setupQueryClient()
    mocks.api.sendProfessionalContract
      .mockRejectedValueOnce(new FunctionCallError('missing_variable', 400, 'x', { label: 'Adresse de la clinique' }))
      .mockRejectedValueOnce({ code: 'P0001', message: 'Aucun modèle de contrat publié.' })
      .mockResolvedValue(REQUEST_ID)
    const { result } = renderHook(() => useSendContract(IDS.professional, 'Marie', { onErrorMessage: vi.fn() }), { wrapper })
    for (let i = 1; i <= 3; i++) {
      act(() => result.current.run('send'))
      await waitFor(() => expect(mocks.api.sendProfessionalContract).toHaveBeenCalledTimes(i))
      await waitFor(() => expect(result.current.isPending).toBe(false))
    }
    const keys = mocks.api.sendProfessionalContract.mock.calls.map(([, , key]) => key as string)
    expect(new Set(keys).size).toBe(3)
  })

  it('draws one key per action', async () => {
    const { wrapper } = setupQueryClient()
    mocks.api.sendProfessionalContract.mockRejectedValue(new FunctionCallError('provider_error', 502, 'x'))
    const { result } = renderHook(() => useSendContract(IDS.professional, 'Marie', { onErrorMessage: vi.fn() }), { wrapper })
    act(() => result.current.run('resend'))
    await waitFor(() => expect(result.current.isPending).toBe(false))
    act(() => result.current.run('regenerate'))
    await waitFor(() => expect(mocks.api.sendProfessionalContract).toHaveBeenCalledTimes(2))
    const calls = mocks.api.sendProfessionalContract.mock.calls as [string, string, string][]
    expect(calls.map(([, action]) => action)).toEqual(['resend', 'regenerate'])
    expect(calls[0]?.[2]).not.toBe(calls[1]?.[2])
  })

  it('a refusal goes to the card as written', async () => {
    const { wrapper } = setupQueryClient()
    const onErrorMessage = vi.fn()
    mocks.api.sendProfessionalContract.mockRejectedValue({ code: 'P0001', message: 'Aucun modèle de contrat publié.' })
    const { result } = renderHook(() => useSendContract(IDS.professional, 'Marie', { onErrorMessage }), { wrapper })
    act(() => result.current.run('send'))
    await waitFor(() => expect(onErrorMessage).toHaveBeenCalledWith('Aucun modèle de contrat publié.', expect.anything()))
  })
})

describe('useSyncContract', () => {
  it('says the outcome, then refreshes the record', async () => {
    const { wrapper, invalidated } = setupQueryClient()
    mocks.sync.mockResolvedValue({ outcome: 'signed' })
    const { result } = renderHook(() => useSyncContract(IDS.professional), { wrapper })
    act(() => result.current.mutate(REQUEST_ID))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.signing.send.synced.updated')))
    expect(mocks.sync).toHaveBeenCalledWith(REQUEST_ID)
    await waitFor(() => expect(invalidated()).toContainEqual(professionalKeys.record(IDS.professional)))
  })

  it('a failure is a toast in French', async () => {
    const { wrapper } = setupQueryClient()
    mocks.sync.mockRejectedValue(new FunctionCallError('internal', 500, 'x'))
    const { result } = renderHook(() => useSyncContract(IDS.professional), { wrapper })
    act(() => result.current.mutate(REQUEST_ID))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t(`${E}.syncFailed`)))
  })
})

describe('useTemplateMutations', () => {
  it('a save refreshes the templates only; a publication every contract card too, never the records around them', async () => {
    const { queryClient, wrapper, invalidated } = setupQueryClient()
    queryClient.setQueryData(professionalKeys.record(IDS.professional), { id: IDS.professional })
    queryClient.setQueryData(professionalKeys.contract(IDS.professional), null)
    queryClient.setQueryData(professionalKeys.submissions(IDS.professional), [])
    mocks.api.updateTemplateVersion.mockResolvedValue(undefined)
    mocks.api.publishTemplateVersion.mockResolvedValue(undefined)
    const { result } = renderHook(() => useTemplateMutations(), { wrapper })
    await act(() => result.current.save.mutateAsync({ versionId: DRAFT_ID, content: { body: {}, variables: [], signers: [], emailSubject: 'a', emailMessage: '' } }))
    await waitFor(() => expect(invalidated()).toEqual([contractTemplateKeys.all]))
    await act(() => result.current.publish.mutateAsync(DRAFT_ID))
    await waitFor(() => expect(queryClient.getQueryState(professionalKeys.contract(IDS.professional))?.isInvalidated).toBe(true))
    expect(invalidated()).toEqual([contractTemplateKeys.all, contractTemplateKeys.all, professionalKeys.all])
    expect(queryClient.getQueryState(professionalKeys.record(IDS.professional))?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(professionalKeys.submissions(IDS.professional))?.isInvalidated).toBe(false)
    expect(mocks.toast.success).toHaveBeenLastCalledWith(t('modules.professionals.contract.toasts.published'))
  })
})

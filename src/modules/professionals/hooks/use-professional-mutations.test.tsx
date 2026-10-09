import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import {
  useActivateProfessional,
  useCreateProfessional,
  useDeactivateProfessional,
  useSetClienteles,
  useSetLanguages,
  useSetMatchingNote,
  useSetMotifs,
  useSetPayerNumber,
  useSetProfessionalEmail,
  useSetProfessions,
  useUpdateMatchingProfile,
  useUpdateProfessional,
  useUpdatePublicProfile,
} from './use-professional-mutations'
import { professionalCatalogKeys, professionalKeys } from './keys'
import { recordFixture } from '../test/fixtures-domain'
import { IDS } from '../test/fixtures'
import { setupQueryClient } from '../test/query-client'
import type { ProfessionalRecord } from '../api/parse'

const mocks = vi.hoisted(() => ({
  api: {
    createProfessional: vi.fn(),
    updateProfessional: vi.fn(),
    updatePublicProfile: vi.fn(),
    updateMatchingProfile: vi.fn(),
    setProfessions: vi.fn(),
    setClienteles: vi.fn(),
    setMotifs: vi.fn(),
    setLanguages: vi.fn(),
    setPayerNumber: vi.fn(),
    setProfessionalEmail: vi.fn(),
    activateProfessional: vi.fn(),
    deactivateProfessional: vi.fn(),
    syncProfessionalSignin: vi.fn(),
    setMatchingNote: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock('../api/record', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => vi.clearAllMocks())

const ID = IDS.professional
const SAVED = t('modules.professionals.toasts.saved')

/** A client holding the record, ready for a mutation hook. */
function setup() {
  const client = setupQueryClient()
  client.queryClient.setQueryData(professionalKeys.record(ID), recordFixture())
  const cached = () => client.queryClient.getQueryData<ProfessionalRecord>(professionalKeys.record(ID))
  return { ...client, cached }
}

/** Runs a mutation hook with `variables` and waits until it settles. */
async function run<V>(hook: () => { mutate: (v: V) => void; isSuccess: boolean; isError: boolean }, variables: V, wrapper: ReturnType<typeof setup>['wrapper']) {
  const { result } = renderHook(hook, { wrapper })
  result.current.mutate(variables)
  await waitFor(() => expect(result.current.isSuccess || result.current.isError).toBe(true))
  return result
}

describe('set mutations: write the returned set, then refresh only what it touched', () => {
  it('useSetMotifs', async () => {
    const { wrapper, cached, invalidated } = setup()
    mocks.api.setMotifs.mockResolvedValue([IDS.deuil])
    await run(() => useSetMotifs(), { id: ID, motifIds: [IDS.deuil] }, wrapper)
    expect(mocks.api.setMotifs).toHaveBeenCalledWith(ID, [IDS.deuil])
    expect(cached()?.motifIds).toEqual([IDS.deuil])
    expect(invalidated()).toEqual([professionalKeys.record(ID), professionalKeys.lists(), professionalKeys.history(ID), professionalCatalogKeys.usage()])
    expect(mocks.toast.success).toHaveBeenCalledWith(SAVED)
  })

  it('useSetLanguages, useSetClienteles, useSetProfessions', async () => {
    const { wrapper, cached } = setup()
    mocks.api.setLanguages.mockResolvedValue([IDS.fr, IDS.en])
    await run(() => useSetLanguages(), { id: ID, languageIds: [IDS.fr, IDS.en] }, wrapper)
    expect(cached()?.languageIds).toEqual([IDS.fr, IDS.en])

    mocks.api.setClienteles.mockResolvedValue([{ id: IDS.children, specialized: false }])
    await run(() => useSetClienteles(), { id: ID, items: [{ id: IDS.children, specialized: false }] }, wrapper)
    expect(mocks.api.setClienteles).toHaveBeenCalledWith(ID, [{ id: IDS.children, specialized: false }])
    expect(cached()?.clienteles).toEqual([{ id: IDS.children, specialized: false }])

    const rows = [{ id: 'r2', titleId: IDS.naturopathe, licenceNumber: null, isPrimary: true }]
    mocks.api.setProfessions.mockResolvedValue(rows)
    await run(() => useSetProfessions(), { id: ID, items: [{ titleId: IDS.naturopathe, licenceNumber: null, isPrimary: true }] }, wrapper)
    expect(cached()?.professions).toEqual(rows)
  })

  it('useSetPayerNumber writes or removes the number', async () => {
    const { wrapper, cached, invalidated } = setup()
    mocks.api.setPayerNumber.mockResolvedValue(undefined)
    await run(() => useSetPayerNumber(), { id: ID, type: 'ivac' as const, number: '999999' }, wrapper)
    expect(mocks.api.setPayerNumber).toHaveBeenCalledWith(ID, 'ivac', '999999')
    expect(cached()?.payerNumbers).toEqual([{ type: 'ivac', number: '999999' }])
    await run(() => useSetPayerNumber(), { id: ID, type: 'ivac' as const, number: null }, wrapper)
    expect(cached()?.payerNumbers).toEqual([])
    // The IVAC number is not in the list.
    expect(invalidated()).not.toContainEqual(professionalKeys.lists())
  })
})

describe('field updates', () => {
  it('useUpdateProfessional merges the patch, without touching usage counts; the lists only for a name or the gender', async () => {
    const { wrapper, cached, invalidated } = setup()
    mocks.api.updateProfessional.mockResolvedValue(undefined)
    await run(() => useUpdateProfessional(), { id: ID, patch: { city: 'Lévis', yearsExperience: 3 } }, wrapper)
    expect(mocks.api.updateProfessional).toHaveBeenCalledWith(ID, { city: 'Lévis', yearsExperience: 3 })
    expect(cached()?.professional).toMatchObject({ city: 'Lévis', firstName: 'Marie' })
    // Address and experience are not in the list.
    expect(invalidated()).toEqual([professionalKeys.record(ID), professionalKeys.history(ID)])

    const names = setup()
    await run(() => useUpdateProfessional(), { id: ID, patch: { lastName: 'Gagnon' } }, names.wrapper)
    expect(names.invalidated()).toEqual([professionalKeys.record(ID), professionalKeys.lists(), professionalKeys.history(ID)])

    // The gender picks the title's form the list shows (P4-342).
    const gender = setup()
    await run(() => useUpdateProfessional(), { id: ID, patch: { gender: 'female' as const } }, gender.wrapper)
    expect(gender.cached()?.professional).toMatchObject({ gender: 'female' })
    expect(gender.invalidated()).toEqual([
      professionalKeys.record(ID),
      professionalKeys.lists(),
      professionalKeys.history(ID),
      professionalKeys.compensation(ID),
      professionalKeys.reviews(),
    ])
  })

  it('useUpdatePublicProfile and useUpdateMatchingProfile merge into their profile; the lists only for new clients', async () => {
    const { wrapper, cached, invalidated } = setup()
    mocks.api.updatePublicProfile.mockResolvedValue(undefined)
    await run(() => useUpdatePublicProfile(), { id: ID, patch: { bio: 'Bio' } }, wrapper)
    expect(cached()?.publicProfile.bio).toBe('Bio')
    expect(invalidated()).toEqual([professionalKeys.record(ID), professionalKeys.history(ID)])

    const matching = setup()
    mocks.api.updateMatchingProfile.mockResolvedValue(undefined)
    await run(() => useUpdateMatchingProfile(), { id: ID, patch: { availabilityPeriods: ['pm' as const] } }, matching.wrapper)
    expect(matching.invalidated()).toEqual([professionalKeys.record(ID), professionalKeys.history(ID)])
    await run(() => useUpdateMatchingProfile(), { id: ID, patch: { acceptingNewClients: false } }, matching.wrapper)
    expect(matching.cached()?.matchingProfile).toMatchObject({ acceptingNewClients: false, availabilityPeriods: ['pm'] })
    expect(matching.invalidated()).toContainEqual(professionalKeys.lists())
  })

  it('useSetProfessionalEmail', async () => {
    const { wrapper, cached } = setup()
    mocks.api.setProfessionalEmail.mockResolvedValue(undefined)
    await run(() => useSetProfessionalEmail(), { id: ID, email: 'nouveau@exemple.ca' }, wrapper)
    expect(cached()?.professional.email).toBe('nouveau@exemple.ca')
  })
})

describe('status', () => {
  it('useActivateProfessional writes the new status and confirms', async () => {
    const { wrapper, cached, invalidated } = setup()
    mocks.api.activateProfessional.mockResolvedValue({ status: 'active', accountChange: null, profileId: null, signinSynced: true })
    await run(() => useActivateProfessional(), { id: ID, overrideReason: 'Dossier complété hors application' }, wrapper)
    expect(mocks.api.activateProfessional).toHaveBeenCalledWith(ID, 'Dossier complété hors application')
    expect(cached()?.professional.status).toBe('active')
    expect(invalidated()).toContainEqual(professionalCatalogKeys.usage())
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.activated'))
  })

  it('useActivateProfessional clears the cached deactivation; an incomplete file keeps the trimmed override reason', async () => {
    const { wrapper, queryClient, cached } = setup()
    const record = recordFixture()
    queryClient.setQueryData(professionalKeys.record(ID), {
      ...record,
      professional: { ...record.professional, status: 'inactive', deactivationReasonId: IDS.ended, deactivationNote: 'Départ', deactivationDisabledAccount: true },
    })
    mocks.api.activateProfessional.mockResolvedValue({ status: 'active', accountChange: 'enabled', profileId: 'u1', signinSynced: true })
    await run(() => useActivateProfessional(), { id: ID, overrideReason: '  Dossier complété hors application \n' }, wrapper)
    expect(cached()?.professional).toMatchObject({
      status: 'active',
      deactivationReasonId: null,
      deactivationNote: null,
      deactivationDisabledAccount: false,
      activationOverrideReason: 'Dossier complété hors application',
    })
  })

  it('useActivateProfessional stores no override reason for a complete file', async () => {
    const { wrapper, queryClient, cached } = setup()
    const record = recordFixture()
    queryClient.setQueryData(professionalKeys.record(ID), { ...record, readiness: { ...record.readiness, complete: true } })
    mocks.api.activateProfessional.mockResolvedValue({ status: 'active', accountChange: null, profileId: null, signinSynced: true })
    await run(() => useActivateProfessional(), { id: ID, overrideReason: 'Inutile' }, wrapper)
    expect(cached()?.professional.activationOverrideReason).toBeNull()
  })

  it('useDeactivateProfessional', async () => {
    const { wrapper, cached } = setup()
    mocks.api.deactivateProfessional.mockResolvedValue({ status: 'inactive', accountChange: null, profileId: null, signinSynced: true })
    await run(() => useDeactivateProfessional(), { id: ID, reasonId: IDS.other, note: 'Départ' }, wrapper)
    expect(mocks.api.deactivateProfessional).toHaveBeenCalledWith(ID, IDS.other, 'Départ')
    expect(cached()?.professional).toMatchObject({
      status: 'inactive',
      deactivationReasonId: IDS.other,
      deactivationNote: 'Départ',
      deactivationDisabledAccount: false,
      activationOverrideReason: null,
    })
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.deactivated'))
  })
})

describe('status: the provider’s account and its sign-in (Task 4b.6, P4-381)', () => {
  const S = 'modules.professionals.toasts.signin'

  it('a deactivation that closed the account says so: sessions ended, sign-in blocked', async () => {
    const { wrapper, cached } = setup()
    mocks.api.deactivateProfessional.mockResolvedValue({ status: 'inactive', accountChange: 'disabled', profileId: 'u1', signinSynced: true })
    await run(() => useDeactivateProfessional(), { id: ID, reasonId: IDS.ended }, wrapper)
    expect(cached()?.professional.deactivationDisabledAccount).toBe(true)
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith(t(`${S}.deactivatedClosed`))
    expect(mocks.toast.warning).not.toHaveBeenCalled()
  })

  it('a reactivation that re-opened the account says so', async () => {
    const { wrapper } = setup()
    mocks.api.activateProfessional.mockResolvedValue({ status: 'active', accountChange: 'enabled', profileId: 'u1', signinSynced: true })
    await run(() => useActivateProfessional(), { id: ID }, wrapper)
    expect(mocks.toast.success).toHaveBeenCalledExactlyOnceWith(t(`${S}.reactivatedOpen`))
  })

  it('a ban Auth refused: a lasting warning with « Réessayer », which syncs the sign-in and says when it worked', async () => {
    const { wrapper } = setup()
    mocks.api.deactivateProfessional.mockResolvedValue({ status: 'inactive', accountChange: 'disabled', profileId: 'u1', signinSynced: false })
    await run(() => useDeactivateProfessional(), { id: ID, reasonId: IDS.ended }, wrapper)
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(mocks.toast.warning).toHaveBeenCalledExactlyOnceWith(t(`${S}.notBlocked`), {
      duration: Infinity,
      action: { label: t('common.retry'), onClick: expect.any(Function) },
    })
    // « Réessayer » fails again: the warning comes back; then it works.
    mocks.api.syncProfessionalSignin.mockResolvedValueOnce({ accountStatus: 'disabled', signinSynced: false })
    mocks.toast.warning.mock.calls[0]?.[1].action.onClick()
    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledTimes(2))
    expect(mocks.api.syncProfessionalSignin).toHaveBeenCalledWith(ID)
    expect(mocks.toast.warning.mock.calls[1]?.[0]).toBe(t(`${S}.notBlocked`))
    mocks.api.syncProfessionalSignin.mockResolvedValueOnce({ accountStatus: 'disabled', signinSynced: true })
    mocks.toast.warning.mock.calls[1]?.[1].action.onClick()
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.blocked`)))
  })

  it('an unban Auth refused: the warning says the account cannot sign in yet; a retry that works says the sign-in is back', async () => {
    const { wrapper } = setup()
    mocks.api.activateProfessional.mockResolvedValue({ status: 'active', accountChange: 'enabled', profileId: 'u1', signinSynced: false })
    await run(() => useActivateProfessional(), { id: ID }, wrapper)
    expect(mocks.toast.warning.mock.calls[0]?.[0]).toBe(t(`${S}.notRestored`))
    mocks.api.syncProfessionalSignin.mockResolvedValueOnce({ accountStatus: 'active', signinSynced: true })
    mocks.toast.warning.mock.calls[0]?.[1].action.onClick()
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.restored`)))
  })

  it('a retry that fails outright shows the error', async () => {
    const { wrapper } = setup()
    mocks.api.deactivateProfessional.mockResolvedValue({ status: 'inactive', accountChange: 'disabled', profileId: 'u1', signinSynced: false })
    await run(() => useDeactivateProfessional(), { id: ID, reasonId: IDS.ended }, wrapper)
    mocks.api.syncProfessionalSignin.mockRejectedValueOnce({ code: '42501', message: 'Permission refusée' })
    mocks.toast.warning.mock.calls[0]?.[1].action.onClick()
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('common.errors.forbidden')))
  })
})

describe('useSetMatchingNote (« Bon à savoir », P4-384)', () => {
  it('writes the stored note into the record, refreshes the record and the history, never the lists', async () => {
    const { wrapper, cached, invalidated } = setup()
    mocks.api.setMatchingNote.mockResolvedValue({ note: 'Écrire avant de réserver.', updatedAt: '2026-10-08T15:00:00+00:00' })
    await run(() => useSetMatchingNote(), { id: ID, note: 'Écrire avant de réserver.' }, wrapper)
    expect(mocks.api.setMatchingNote).toHaveBeenCalledWith(ID, 'Écrire avant de réserver.')
    expect(cached()?.matchingNote).toEqual({ note: 'Écrire avant de réserver.', updatedAt: '2026-10-08T15:00:00+00:00' })
    expect(invalidated()).toEqual([professionalKeys.record(ID), professionalKeys.history(ID)])
    expect(mocks.toast.success).toHaveBeenCalledWith(SAVED)
  })
})

describe('useCreateProfessional', () => {
  it('returns the new id and refreshes the lists and usage counts', async () => {
    const { wrapper, invalidated } = setup()
    mocks.api.createProfessional.mockResolvedValue('new-id')
    const input = { firstName: 'Marie', lastName: 'Tremblay', email: 'marie@exemple.ca', titleId: null, licenceNumber: null }
    const result = await run(() => useCreateProfessional(), input, wrapper)
    expect(mocks.api.createProfessional).toHaveBeenCalledWith(input)
    expect(result.current).toMatchObject({ data: 'new-id' })
    expect(invalidated()).toEqual([professionalKeys.lists(), professionalCatalogKeys.usage()])
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.created'))
  })

  it('resolves without waiting for the lists to refetch', async () => {
    const { wrapper, invalidate } = setup()
    invalidate.mockReturnValue(new Promise(() => {}))
    mocks.api.createProfessional.mockResolvedValue('new-id')
    const { result } = renderHook(() => useCreateProfessional(), { wrapper })
    await expect(result.current.mutateAsync({ firstName: 'M', lastName: 'T', email: 'm@t.ca', titleId: null, licenceNumber: null })).resolves.toBe('new-id')
    expect(invalidate).toHaveBeenCalled()
  })
})

describe('errors', () => {
  it('shows a P0001 message as is, reports nothing, and leaves the cache alone', async () => {
    const { wrapper, cached, invalidated } = setup()
    mocks.api.setLanguages.mockRejectedValue({ code: 'P0001', message: 'Au moins une langue est requise.' })
    await run(() => useSetLanguages(), { id: ID, languageIds: [] }, wrapper)
    expect(mocks.toast.error).toHaveBeenCalledWith('Au moins une langue est requise.')
    expect(mocks.captureException).not.toHaveBeenCalled()
    expect(cached()?.languageIds).toEqual([IDS.fr])
    expect(invalidated()).toEqual([])
  })

  it('shows the generic refusal for 42501, unreported, and refetches the caller’s access', async () => {
    const { wrapper, invalidated } = setup()
    mocks.api.setMotifs.mockRejectedValue({ code: '42501', message: 'Permission refusée : professionals.matching' })
    await run(() => useSetMotifs(), { id: ID, motifIds: [] }, wrapper)
    expect(mocks.toast.error).toHaveBeenCalledWith(t('common.errors.forbidden'))
    expect(mocks.captureException).not.toHaveBeenCalled()
    expect(invalidated()).toEqual([accessKeys.all, professionalCatalogKeys.all])
  })

  it('reports other codes and shows the module fallback', async () => {
    const { wrapper } = setup()
    mocks.api.setMotifs.mockRejectedValue({ code: '22023', message: 'Motif inconnu.' })
    await run(() => useSetMotifs(), { id: ID, motifIds: ['x'] }, wrapper)
    expect(mocks.toast.error).toHaveBeenCalledWith(t('modules.professionals.errors.saveFailed'))
    expect(mocks.captureException).toHaveBeenCalledTimes(1)
    expect(mocks.captureException.mock.calls[0]?.[1]).toEqual({ tags: { area: 'professionals', code: '22023' } })
  })

  it('hands the message to the caller instead of a toast (a field error)', async () => {
    const { wrapper } = setup()
    const onErrorMessage = vi.fn()
    const error = { code: 'P0001', message: 'Ce courriel est déjà utilisé.' }
    mocks.api.createProfessional.mockRejectedValue(error)
    await run(() => useCreateProfessional({ onErrorMessage }), { firstName: 'M', lastName: 'T', email: 'x@y.ca', titleId: null, licenceNumber: null }, wrapper)
    expect(onErrorMessage).toHaveBeenCalledWith('Ce courriel est déjà utilisé.', error)
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })
})

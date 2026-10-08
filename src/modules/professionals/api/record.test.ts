import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionCallError } from '@/core/supabase/functions'
import {
  activateProfessional,
  createProfessional,
  deactivateProfessional,
  fetchProfessionalRecord,
  setClienteles,
  setLanguages,
  setMatchingNote,
  setMotifs,
  setPayerNumber,
  setProfessionalEmail,
  setProfessions,
  syncProfessionalSignin,
  updateMatchingProfile,
  updateProfessional,
  updatePublicProfile,
  type ProfessionalPatch,
} from './record'
import { UNEXPECTED_SHAPE } from './parse'
import { IDS, RECORD_JSON } from '../test/fixtures'

const mocks = vi.hoisted(() => {
  const select = vi.fn()
  const eq = vi.fn(() => ({ select }))
  const update = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ update }))
  const rpc = vi.fn()
  const invokeFunction = vi.fn()
  return { from, update, eq, select, rpc, invokeFunction }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('@/core/supabase/functions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/supabase/functions')>()),
  invokeFunction: mocks.invokeFunction,
}))

afterEach(() => vi.clearAllMocks())

const ok = (data: unknown) => mocks.rpc.mockResolvedValue({ data, error: null })
const fail = (error: unknown) => mocks.rpc.mockResolvedValue({ data: null, error })
const ID = IDS.professional

describe('reads', () => {
  it('fetchProfessionalRecord: one RPC, parsed', async () => {
    ok(RECORD_JSON)
    const record = await fetchProfessionalRecord(ID)
    expect(mocks.rpc).toHaveBeenCalledWith('get_professional_record', { p_id: ID })
    expect(record?.professional.firstName).toBe('Marie')
    expect(record?.motifIds).toEqual([IDS.anxiete])
  })

  it('fetchProfessionalRecord: null outside the caller’s reach', async () => {
    ok(null)
    await expect(fetchProfessionalRecord(ID)).resolves.toBeNull()
  })

  it('fetchProfessionalRecord: shape error', async () => {
    ok({ professional: {} })
    await expect(fetchProfessionalRecord(ID)).rejects.toThrow(UNEXPECTED_SHAPE)
  })

  it('throws the RPC error unchanged', async () => {
    const error = { code: '57014', message: 'timeout' }
    fail(error)
    await expect(fetchProfessionalRecord(ID)).rejects.toBe(error)
  })
})

describe('createProfessional', () => {
  it('passes the title and licence, null when none', async () => {
    ok('new-id')
    await expect(createProfessional({ firstName: 'Marie', lastName: 'Tremblay', email: 'marie@exemple.ca', titleId: null, licenceNumber: null })).resolves.toBe('new-id')
    expect(mocks.rpc).toHaveBeenCalledWith('create_professional', {
      p_first_name: 'Marie',
      p_last_name: 'Tremblay',
      p_email: 'marie@exemple.ca',
      p_profession_title_id: null,
      p_licence_number: null,
    })
  })

  it('throws the duplicate-email refusal unchanged', async () => {
    const error = { code: 'P0001', message: 'Ce courriel est déjà utilisé.' }
    fail(error)
    await expect(createProfessional({ firstName: 'M', lastName: 'T', email: 'x@y.ca', titleId: IDS.psychologue, licenceNumber: '12345' })).rejects.toBe(error)
  })
})

describe('column updates', () => {
  it('updateProfessional writes the granted columns of one row', async () => {
    mocks.select.mockResolvedValue({ data: [{ id: ID }], error: null })
    await updateProfessional(ID, { city: 'Lévis', postalCode: 'G6V 1A1', yearsExperience: null, gender: 'female' })
    expect(mocks.from).toHaveBeenCalledWith('professionals')
    expect(mocks.update).toHaveBeenCalledWith({ city: 'Lévis', postal_code: 'G6V 1A1', years_experience: null, gender: 'female' })
    expect(mocks.eq).toHaveBeenCalledWith('id', ID)
    expect(mocks.select).toHaveBeenCalledWith('id')
  })

  it('a non-granted column is a compile error', () => {
    // @ts-expect-error status goes through activate/deactivate, never a column update
    const patch: ProfessionalPatch = { status: 'active' }
    expect(patch).toBeDefined()
  })

  it('treats a row hidden by RLS (no row updated) as a refusal', async () => {
    mocks.select.mockResolvedValue({ data: [], error: null })
    await expect(updateProfessional(ID, { city: 'Lévis' })).rejects.toMatchObject({ code: '42501' })
  })

  it('throws the update error unchanged', async () => {
    const error = { code: '23514', message: 'check violation' }
    mocks.select.mockResolvedValue({ data: null, error })
    await expect(updateProfessional(ID, { city: 'Lévis' })).rejects.toBe(error)
  })

  it('sends nothing for an empty patch', async () => {
    await updateProfessional(ID, {})
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('updatePublicProfile', async () => {
    mocks.select.mockResolvedValue({ data: [{ professional_id: ID }], error: null })
    await updatePublicProfile(ID, { bio: 'Bio', publicEmail: null })
    expect(mocks.from).toHaveBeenCalledWith('professional_public_profiles')
    expect(mocks.update).toHaveBeenCalledWith({ bio: 'Bio', public_email: null })
    expect(mocks.eq).toHaveBeenCalledWith('professional_id', ID)
    expect(mocks.select).toHaveBeenCalledWith('professional_id')
  })

  it('updateMatchingProfile', async () => {
    mocks.select.mockResolvedValue({ data: [{ professional_id: ID }], error: null })
    await updateMatchingProfile(ID, { acceptingNewClients: false, availabilityPeriods: ['am'], availabilityNote: null })
    expect(mocks.from).toHaveBeenCalledWith('professional_matching_profiles')
    expect(mocks.update).toHaveBeenCalledWith({ accepting_new_clients: false, availability_periods: ['am'], availability_note: null })
  })

  it('updateMatchingProfile writes the places offered alone (the database stamps their date, P4-382)', async () => {
    mocks.select.mockResolvedValue({ data: [{ professional_id: ID }], error: null })
    await updateMatchingProfile(ID, { newClientPlaces: 4 })
    expect(mocks.update).toHaveBeenCalledWith({ new_client_places: 4 })
  })
})

describe('« Bon à savoir » (P4-384)', () => {
  it('setMatchingNote sends the text and returns the stored note', async () => {
    ok({ note: 'Écrire avant de réserver.', updated_at: '2026-10-08T15:00:00+00:00' })
    await expect(setMatchingNote(ID, 'Écrire avant de réserver.')).resolves.toEqual({ note: 'Écrire avant de réserver.', updatedAt: '2026-10-08T15:00:00+00:00' })
    expect(mocks.rpc).toHaveBeenCalledWith('set_professional_matching_note', { p_id: ID, p_note: 'Écrire avant de réserver.' })
  })

  it('setMatchingNote with null clears it (null back)', async () => {
    ok(null)
    await expect(setMatchingNote(ID, null)).resolves.toBeNull()
    expect(mocks.rpc).toHaveBeenCalledWith('set_professional_matching_note', { p_id: ID, p_note: '' })
  })
})

describe('set RPCs', () => {
  it('setProfessions sends the whole list and returns the rows (licence may be null)', async () => {
    ok([
      { id: IDS.professionRow, profession_title_id: IDS.psychologue, licence_number: '12345', is_primary: false },
      { id: 'row-2', profession_title_id: IDS.naturopathe, licence_number: null, is_primary: true },
    ])
    const rows = await setProfessions(ID, [
      { titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: false },
      { titleId: IDS.naturopathe, licenceNumber: null, isPrimary: true },
    ])
    expect(mocks.rpc).toHaveBeenCalledWith('set_professional_professions', {
      p_id: ID,
      p_items: [
        { title_id: IDS.psychologue, licence_number: '12345', is_primary: false },
        { title_id: IDS.naturopathe, licence_number: null, is_primary: true },
      ],
    })
    expect(rows[1]).toEqual({ id: 'row-2', titleId: IDS.naturopathe, licenceNumber: null, isPrimary: true })
  })

  it('setClienteles sends {id, specialized} and maps the returned set', async () => {
    ok([{ clientele_id: IDS.couples, is_specialized: true }])
    await expect(setClienteles(ID, [{ id: IDS.couples, specialized: true }])).resolves.toEqual([{ id: IDS.couples, specialized: true }])
    expect(mocks.rpc).toHaveBeenCalledWith('set_professional_clienteles', { p_id: ID, p_items: [{ id: IDS.couples, specialized: true }] })
  })

  it('setMotifs and setLanguages send the ids and return the new set', async () => {
    ok([IDS.anxiete])
    await expect(setMotifs(ID, [IDS.anxiete])).resolves.toEqual([IDS.anxiete])
    expect(mocks.rpc).toHaveBeenCalledWith('set_professional_motifs', { p_id: ID, p_motif_ids: [IDS.anxiete] })

    ok([IDS.fr, IDS.en])
    await expect(setLanguages(ID, [IDS.fr, IDS.en])).resolves.toEqual([IDS.fr, IDS.en])
    expect(mocks.rpc).toHaveBeenCalledWith('set_professional_languages', { p_id: ID, p_language_ids: [IDS.fr, IDS.en] })
  })

  it('throws a set refusal unchanged', async () => {
    const error = { code: 'P0001', message: 'Au moins une langue est requise.' }
    fail(error)
    await expect(setLanguages(ID, [])).rejects.toBe(error)
  })

  it('setPayerNumber stores a number, null deletes it', async () => {
    ok(null)
    await setPayerNumber(ID, 'ivac', '123456')
    expect(mocks.rpc).toHaveBeenCalledWith('set_professional_payer_number', { p_id: ID, p_payer_type: 'ivac', p_number: '123456' })
    await setPayerNumber(ID, 'ivac', null)
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_professional_payer_number', { p_id: ID, p_payer_type: 'ivac', p_number: null })
  })

  it('setProfessionalEmail', async () => {
    ok(null)
    await setProfessionalEmail(ID, 'nouveau@exemple.ca')
    expect(mocks.rpc).toHaveBeenCalledWith('set_professional_email', { p_id: ID, p_email: 'nouveau@exemple.ca' })
  })
})

describe('status (professionals-set-status, Task 4b.6)', () => {
  const answer = (status: string, change: string | null, synced = true) =>
    mocks.invokeFunction.mockResolvedValue({ status, account_change: change, profile_id: change ? IDS.admin : null, signin_synced: synced })

  it('activateProfessional goes through the function and returns the change (no account change: nulls)', async () => {
    answer('active', null)
    await expect(activateProfessional(ID)).resolves.toEqual({ status: 'active', accountChange: null, profileId: null, signinSynced: true })
    expect(mocks.invokeFunction).toHaveBeenCalledExactlyOnceWith('professionals-set-status', { action: 'activate', professional_id: ID })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('activateProfessional passes the override reason when given; an unban Auth refused reads signinSynced false', async () => {
    answer('active', 'enabled', false)
    await expect(activateProfessional(ID, 'Dossier complété hors application')).resolves.toEqual({
      status: 'active',
      accountChange: 'enabled',
      profileId: IDS.admin,
      signinSynced: false,
    })
    expect(mocks.invokeFunction).toHaveBeenCalledWith('professionals-set-status', {
      action: 'activate',
      professional_id: ID,
      override_reason: 'Dossier complété hors application',
    })
  })

  it('deactivateProfessional passes the reason and the note when given', async () => {
    answer('inactive', 'disabled')
    await expect(deactivateProfessional(ID, IDS.ended)).resolves.toMatchObject({ accountChange: 'disabled', signinSynced: true })
    expect(mocks.invokeFunction).toHaveBeenCalledWith('professionals-set-status', { action: 'deactivate', professional_id: ID, reason_id: IDS.ended })
    answer('inactive', null)
    await deactivateProfessional(ID, IDS.leave, null)
    expect(mocks.invokeFunction).toHaveBeenLastCalledWith('professionals-set-status', { action: 'deactivate', professional_id: ID, reason_id: IDS.leave })
    await deactivateProfessional(ID, IDS.other, 'Départ à l’étranger')
    expect(mocks.invokeFunction).toHaveBeenLastCalledWith('professionals-set-status', {
      action: 'deactivate',
      professional_id: ID,
      reason_id: IDS.other,
      note: 'Départ à l’étranger',
    })
  })

  it('syncProfessionalSignin (« Réessayer ») asks for sync_signin', async () => {
    mocks.invokeFunction.mockResolvedValue({ account_status: 'disabled', signin_synced: true })
    await expect(syncProfessionalSignin(ID)).resolves.toEqual({ accountStatus: 'disabled', signinSynced: true })
    expect(mocks.invokeFunction).toHaveBeenCalledExactlyOnceWith('professionals-set-status', { action: 'sync_signin', professional_id: ID })
  })

  it('throws the function’s refusals as the RPC errors they pass on (P0001 with its HINT, 42501, 40001)', async () => {
    mocks.invokeFunction.mockRejectedValue(
      new FunctionCallError('invalid_request', 400, 'Ce dossier est déjà actif.', { refusal: true, field: 'status' }),
    )
    await expect(activateProfessional(ID)).rejects.toEqual({ code: 'P0001', message: 'Ce dossier est déjà actif.', hint: 'status' })
    mocks.invokeFunction.mockRejectedValue(new FunctionCallError('forbidden', 403, 'Not allowed'))
    await expect(activateProfessional(ID)).rejects.toMatchObject({ code: '42501' })
    mocks.invokeFunction.mockRejectedValue(new FunctionCallError('conflict', 409, 'Record changed'))
    await expect(deactivateProfessional(ID, IDS.leave)).rejects.toMatchObject({ code: '40001' })
  })

  it('throws anything else unchanged, and an unexpected answer as the shape error', async () => {
    const error = new FunctionCallError('network', 0, 'Function unreachable')
    mocks.invokeFunction.mockRejectedValue(error)
    await expect(activateProfessional(ID)).rejects.toBe(error)
    mocks.invokeFunction.mockResolvedValue([{ status: 'active', account_change: null, profile_id: null }])
    await expect(activateProfessional(ID)).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

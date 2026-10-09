import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROFESSIONAL_JSON, RECORD_JSON } from '../test/fixtures'
import { MY_SUBMISSION_JSON } from '../test/fixtures-questionnaire'
import { UNEXPECTED_SHAPE } from './parse'
import {
  fetchMyProfessionalPrivate,
  fetchMyProfessionalRecord,
  fetchMySubmission,
  saveMySubmissionDraft,
  saveMySubmissionPrivate,
  startMyProfileUpdate,
  submitMyProfile,
} from './self'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invokeFunction: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('@/core/supabase/functions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/supabase/functions')>()),
  invokeFunction: mocks.invokeFunction,
}))

afterEach(() => vi.clearAllMocks())

describe('fetchMySubmission', () => {
  it('reads the open submission in the module’s shape', async () => {
    mocks.rpc.mockResolvedValue({ data: MY_SUBMISSION_JSON, error: null })
    const submission = await fetchMySubmission()
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_submission')
    expect(submission).toMatchObject({
      id: MY_SUBMISSION_JSON.id,
      kind: 'onboarding',
      requestedSections: MY_SUBMISSION_JSON.requested_sections,
      values: { portrait: { bio: 'Bonjour' } },
      private: null,
      onFile: { hasSin: false, hasBankAccount: false },
      collectSin: false,
      signedConsentVersion: null,
      professional: { firstName: 'Félix', lastName: 'Gauthier', email: 'provider@mana.test', gender: null },
    })
  })

  it('maps the private step’s masks, never more', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ...MY_SUBMISSION_JSON,
        private: { business_number: null, gst_number: null, qst_number: null, bank_institution: '815', bank_transit: '30000', bank_account_last4: '4567', sin_last3: null },
        on_file: { has_sin: true, has_bank_account: false },
      },
      error: null,
    })
    const submission = await fetchMySubmission()
    expect(submission?.private).toEqual({
      businessNumber: null,
      gstNumber: null,
      qstNumber: null,
      bankInstitution: '815',
      bankTransit: '30000',
      bankAccountLast4: '4567',
      sinLast3: null,
    })
    expect(submission?.onFile).toEqual({ hasSin: true, hasBankAccount: false })
  })

  it('is null when there is nothing to complete', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(fetchMySubmission()).resolves.toBeNull()
  })

  it('refuses an unknown section without quoting it', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...MY_SUBMISSION_JSON, requested_sections: ['approaches'] }, error: null })
    await expect(fetchMySubmission()).rejects.toThrow(UNEXPECTED_SHAPE)
  })

  it('throws the PostgREST error unchanged', async () => {
    const error = { code: '42501', message: 'Permission refusée' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchMySubmission()).rejects.toBe(error)
  })
})

describe('saves', () => {
  it('saves one section’s keys and returns the new updated_at', async () => {
    mocks.rpc.mockResolvedValue({ data: '2026-10-08T14:33:00+00:00', error: null })
    await expect(saveMySubmissionDraft('personal', { city: 'Laval' })).resolves.toBe('2026-10-08T14:33:00+00:00')
    expect(mocks.rpc).toHaveBeenCalledWith('save_my_submission_draft', { p_section: 'personal', p_values: { city: 'Laval' } })
  })

  it('sends the private step to its own RPC, null keeping the account and the SIN', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await saveMySubmissionPrivate({
      businessNumber: null,
      gstNumber: '123456789RT0001',
      qstNumber: null,
      bankInstitution: '815',
      bankTransit: '30000',
      bankAccount: null,
      sin: null,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('save_my_submission_private', {
      p_sin: null,
      p_business_number: null,
      p_gst_number: '123456789RT0001',
      p_qst_number: null,
      p_bank_institution: '815',
      p_bank_transit: '30000',
      p_bank_account: null,
    })
  })

  it('reads the record’s masks', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ sin_last3: '286', business_number: null, gst_number: null, qst_number: null, bank_institution: '815', bank_transit: '30000', bank_account_last4: '4567', updated_at: null }],
      error: null,
    })
    await expect(fetchMyProfessionalPrivate()).resolves.toEqual({
      sinLast3: '286',
      businessNumber: null,
      gstNumber: null,
      qstNumber: null,
      bankInstitution: '815',
      bankTransit: '30000',
      bankAccountLast4: '4567',
    })
  })

  it('submits through professionals-submit with an empty body', async () => {
    mocks.invokeFunction.mockResolvedValue({ ok: true })
    await submitMyProfile()
    expect(mocks.invokeFunction).toHaveBeenCalledWith('professionals-submit', {})
  })
})

describe('« Mon profil »', () => {
  it('reads the caller’s own record in the record’s shape, with the gender', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...RECORD_JSON, professional: { ...PROFESSIONAL_JSON, gender: 'female' } }, error: null })
    const record = await fetchMyProfessionalRecord()
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_professional_record')
    expect(record?.professional).toMatchObject({ firstName: 'Marie', gender: 'female' })
    expect(record?.motifIds).toEqual(RECORD_JSON.motif_ids)
    // No readiness in her own record: her permissions cannot compute it (P4-473).
    expect(record).not.toHaveProperty('readiness')
  })

  it('answers null when no file is linked to the account', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(fetchMyProfessionalRecord()).resolves.toBeNull()
  })

  it('starts an update with the sections chosen and answers its id', async () => {
    mocks.rpc.mockResolvedValue({ data: 'sub-1', error: null })
    await expect(startMyProfileUpdate(['portrait', 'motifs'])).resolves.toBe('sub-1')
    expect(mocks.rpc).toHaveBeenCalledWith('start_my_profile_update', { p_sections: ['portrait', 'motifs'] })
  })

  it('passes a refusal on unchanged', async () => {
    const error = { code: 'P0001', message: 'Une soumission est déjà en cours.', hint: 'submission' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(startMyProfileUpdate(['portrait'])).rejects.toBe(error)
  })
})

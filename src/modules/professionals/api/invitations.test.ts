import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionCallError } from '@/core/supabase/functions'
import {
  fetchInvitationStates,
  fetchProfessionalEmails,
  fetchProfessionalOnboarding,
  requestProfessionalUpdate,
  revokeProfessionalInvitation,
  sendProfessionalInvitation,
} from './invitations'
import { UNEXPECTED_SHAPE } from './parse'
import { IDS } from '../test/fixtures'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invokeFunction: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('@/core/supabase/functions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/supabase/functions')>()),
  invokeFunction: mocks.invokeFunction,
}))

afterEach(() => vi.clearAllMocks())

const ID = IDS.professional

describe('sendProfessionalInvitation', () => {
  it.each(['send', 'resend', 'new_link'] as const)('%s: one call to professionals-invite, never a link in the answer (P4-260)', async (action) => {
    mocks.invokeFunction.mockResolvedValue({ ok: true, expires_at: '2026-10-15T14:00:00Z' })
    await expect(sendProfessionalInvitation(ID, action)).resolves.toEqual({ expiresAt: '2026-10-15T14:00:00Z', emailProblem: null })
    expect(mocks.invokeFunction).toHaveBeenCalledExactlyOnceWith('professionals-invite', { action, professional_id: ID })
  })

  it('the link exists but its email failed: resolved with the problem (the answer names the professional)', async () => {
    mocks.invokeFunction.mockRejectedValue(new FunctionCallError('rate_limited', 429, 'Created, email not sent', { professional_id: ID }, 120))
    await expect(sendProfessionalInvitation(ID, 'send')).resolves.toEqual({ expiresAt: null, emailProblem: { code: 'rate_limited', retryAfter: 120 } })
  })

  it('a double click refused by the file’s guard (no ids: nothing created) is thrown', async () => {
    const error = new FunctionCallError('rate_limited', 429, 'Too many', {}, 5)
    mocks.invokeFunction.mockRejectedValue(error)
    await expect(sendProfessionalInvitation(ID, 'resend')).rejects.toBe(error)
  })

  it('passes an RPC refusal on as the RPC error, its field as the HINT (P4-262)', async () => {
    mocks.invokeFunction.mockRejectedValue(
      new FunctionCallError('invalid_request', 400, 'Ce professionnel a déjà un compte.', { refusal: true, field: 'account' }),
    )
    await expect(sendProfessionalInvitation(ID, 'send')).rejects.toEqual({ code: 'P0001', message: 'Ce professionnel a déjà un compte.', hint: 'account' })
  })

  it('a 403 forbidden reads as 42501', async () => {
    mocks.invokeFunction.mockRejectedValue(new FunctionCallError('forbidden', 403, 'Permission refusée'))
    await expect(sendProfessionalInvitation(ID, 'send')).rejects.toEqual({ code: '42501', message: 'Permission refusée' })
  })

  it('an unexpected answer is a shape error', async () => {
    mocks.invokeFunction.mockResolvedValue({ ok: true, link: 'https://…' })
    await expect(sendProfessionalInvitation(ID, 'send')).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

describe('revokeProfessionalInvitation', () => {
  it('calls the function with « revoke »', async () => {
    mocks.invokeFunction.mockResolvedValue({ ok: true })
    await revokeProfessionalInvitation(ID)
    expect(mocks.invokeFunction).toHaveBeenCalledWith('professionals-invite', { action: 'revoke', professional_id: ID })
  })

  it('« Aucune invitation en cours. » comes back as the RPC refusal', async () => {
    mocks.invokeFunction.mockRejectedValue(new FunctionCallError('invalid_request', 400, 'Aucune invitation en cours.', { refusal: true, field: 'invitation' }))
    await expect(revokeProfessionalInvitation(ID)).rejects.toEqual({ code: 'P0001', message: 'Aucune invitation en cours.', hint: 'invitation' })
  })
})

describe('requestProfessionalUpdate', () => {
  it('sends the sections and returns the submission', async () => {
    mocks.invokeFunction.mockResolvedValue({ ok: true, submission_id: 's1' })
    await expect(requestProfessionalUpdate(ID, ['portrait', 'languages'])).resolves.toEqual({ submissionId: 's1', emailProblem: null })
    expect(mocks.invokeFunction).toHaveBeenCalledWith('professionals-invite', { action: 'request_update', professional_id: ID, sections: ['portrait', 'languages'] })
  })

  it('the request exists but its email failed (P4-267): resolved with the problem', async () => {
    mocks.invokeFunction.mockRejectedValue(new FunctionCallError('provider_error', 502, 'Created, email not sent', { professional_id: ID, submission_id: 's1' }))
    await expect(requestProfessionalUpdate(ID, ['portrait'])).resolves.toEqual({ submissionId: 's1', emailProblem: { code: 'provider_error', retryAfter: null } })
  })

  it('« Une soumission est déjà en cours. » is thrown as the refusal', async () => {
    mocks.invokeFunction.mockRejectedValue(new FunctionCallError('invalid_request', 400, 'Une soumission est déjà en cours.', { refusal: true, field: 'submission' }))
    await expect(requestProfessionalUpdate(ID, ['portrait'])).rejects.toMatchObject({ code: 'P0001', hint: 'submission' })
  })
})

describe('reads', () => {
  it('fetchProfessionalOnboarding: one RPC, parsed; null without link or submission', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(fetchProfessionalOnboarding(ID)).resolves.toBeNull()
    expect(mocks.rpc).toHaveBeenCalledWith('get_professional_onboarding', { p_id: ID })
  })

  it('fetchInvitationStates: the whole clinic, by professional id', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          professional_id: ID,
          state: 'expired',
          sent_at: '2026-10-01T14:00:00Z',
          expires_at: '2026-10-08T14:00:00Z',
          opened_at: null,
          used_at: null,
          submission_id: null,
          submission_kind: null,
          submission_status: null,
          submitted_at: null,
          onboarding_approved: false,
        },
      ],
      error: null,
    })
    const states = await fetchInvitationStates()
    expect(mocks.rpc).toHaveBeenCalledWith('list_professional_invitation_states')
    expect(states.get(ID)?.invitation?.state).toBe('expired')
  })

  it('fetchProfessionalEmails: the professional’s emails, at most 100', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          id: 'm1',
          template_key: 'professionals.invite',
          template_label: "Invitation d'un professionnel",
          status: 'delivered',
          to_email: 'marie.t@exemple.ca',
          sent_by: null,
          sent_by_name: null,
          created_at: '2026-10-08T14:00:00Z',
          sent_at: '2026-10-08T14:00:01Z',
          last_event_at: null,
          error_code: null,
        },
      ],
      error: null,
    })
    const [email] = await fetchProfessionalEmails(ID)
    expect(mocks.rpc).toHaveBeenCalledWith('list_subject_emails', { p_subject_type: 'professional', p_subject_id: ID, p_limit: 100 })
    expect(email).toMatchObject({ id: 'm1', templateLabel: "Invitation d'un professionnel", sentBy: null, toEmail: 'marie.t@exemple.ca' })
  })

  it('throws the RPC error unchanged', async () => {
    const error = { code: '42501', message: 'Permission refusée : professionals.view' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchInvitationStates()).rejects.toBe(error)
  })
})

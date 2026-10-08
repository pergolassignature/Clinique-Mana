import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EMAIL_LOG_PAGE_SIZE,
  EmailFunctionError,
  fetchEmailSender,
  lastWebhookEventAt,
  listEmailLog,
  listEmailTemplates,
  previewEmail,
  resetEmailTemplate,
  saveEmailTemplate,
  sendTestEmail,
  setEmailSender,
  setEmailSendingDomain,
  webhookUrl,
} from './api'

const mocks = vi.hoisted(() => {
  const single = vi.fn()
  const select = vi.fn(() => ({ single }))
  return { rpc: vi.fn(), from: vi.fn(() => ({ select })), select, single, invoke: vi.fn() }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from, functions: { invoke: mocks.invoke } } }))

afterEach(() => vi.clearAllMocks())

const TEMPLATE = {
  key: 'core.staff_invite',
  module_key: 'core',
  label: "Invitation d'un membre du personnel",
  description: 'Envoyé quand un administrateur invite une personne.',
  is_custom: false,
  version: 0,
  updated_at: null,
  updated_by_name: null,
  subject: 'Votre accès à {{clinic.name}}',
  body: 'Bonjour {{invitee.display_name}},',
  button_label: 'Créer mon accès',
  variables: [{ path: 'clinic.name', label: 'Nom de la clinique', sample: 'Clinique MANA', required: true, kind: 'text' }],
}

const LOG_ROW = {
  id: 'e0000000-0000-0000-0000-000000000001',
  template_key: 'core.staff_invite',
  template_label: "Invitation d'un membre du personnel",
  status: 'bounced',
  to_email: null,
  subject_type: 'staff_invitation',
  subject_id: 'f0000000-0000-0000-0000-000000000001',
  created_at: '2026-10-08T12:00:00+00:00',
  sent_at: '2026-10-08T12:00:01+00:00',
  last_event_at: null,
  error_code: null,
}

const DRAFT = { subject: 'Objet', body: 'Texte', button_label: null }

/** A function's error answer, as supabase-js hands it over. */
const httpError = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

describe('sender', () => {
  it('reads the sender of the caller’s org (RLS: own org, settings.view)', async () => {
    const sender = { from_name: 'Clinique MANA', from_address: 'no-reply@gestion.cliniquemana.com', reply_to: null, sending_domain: 'gestion.cliniquemana.com' }
    mocks.single.mockResolvedValue({ data: sender, error: null })
    await expect(fetchEmailSender()).resolves.toEqual(sender)
    expect(mocks.from).toHaveBeenCalledWith('email_settings')
    expect(mocks.select).toHaveBeenCalledWith('from_name, from_address, reply_to, sending_domain')
  })

  it('saves the sender (no reply-to → empty, which the RPC clears) and the domain', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await setEmailSender({ from_name: 'Clinique', from_address: 'info@gestion.cliniquemana.com', reply_to: null })
    await setEmailSendingDomain('courriel.cliniquemana.com')
    expect(mocks.rpc.mock.calls).toEqual([
      ['set_email_sender', { p_from_name: 'Clinique', p_from_address: 'info@gestion.cliniquemana.com', p_reply_to: '' }],
      ['set_email_sending_domain', { p_domain: 'courriel.cliniquemana.com' }],
    ])
  })

  it('throws the RPC error', async () => {
    const error = { code: '42501', message: 'Permission refusée : settings.integrations_manage' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(setEmailSendingDomain('x.ca')).rejects.toBe(error)
  })
})

describe('templates', () => {
  it('lists the effective templates, variables parsed', async () => {
    mocks.rpc.mockResolvedValue({ data: [TEMPLATE], error: null })
    await expect(listEmailTemplates()).resolves.toEqual([TEMPLATE])
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_email_templates')
  })

  it('saves a draft (no button → empty) and resets to the default', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await saveEmailTemplate('core.staff_invite', DRAFT)
    await resetEmailTemplate('core.staff_invite')
    expect(mocks.rpc.mock.calls).toEqual([
      ['save_email_template', { p_key: 'core.staff_invite', p_subject: 'Objet', p_body: 'Texte', p_button_label: '' }],
      ['reset_email_template', { p_key: 'core.staff_invite' }],
    ])
  })

  it('throws the P0001 error of a refused save', async () => {
    const error = { code: 'P0001', message: 'Variable inconnue : {{x}}' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(saveEmailTemplate('core.staff_invite', DRAFT)).rejects.toBe(error)
  })
})

describe('listEmailLog', () => {
  it('asks for the newest page, with no filter', async () => {
    mocks.rpc.mockResolvedValue({ data: [LOG_ROW], error: null })
    await expect(listEmailLog({ templateKey: null, status: null, from: null }, null)).resolves.toEqual([LOG_ROW])
    expect(EMAIL_LOG_PAGE_SIZE).toBe(50)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_email_log', { p_limit: 50 })
  })

  it('passes the filters and both cursor fields of the last row seen', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await listEmailLog(
      { templateKey: 'core.staff_invite', status: 'bounced', from: '2026-10-02T04:00:00.000Z' },
      { before: LOG_ROW.created_at, beforeId: LOG_ROW.id },
    )
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_email_log', {
      p_limit: 50,
      p_template_key: 'core.staff_invite',
      p_status: 'bounced',
      p_from: '2026-10-02T04:00:00.000Z',
      p_before: LOG_ROW.created_at,
      p_before_id: LOG_ROW.id,
    })
  })
})

describe('lastWebhookEventAt', () => {
  it('reads the last event of a provider, null when none was received', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: '2026-10-08T12:00:00+00:00', error: null }).mockResolvedValueOnce({ data: null, error: null })
    await expect(lastWebhookEventAt('resend')).resolves.toBe('2026-10-08T12:00:00+00:00')
    await expect(lastWebhookEventAt('resend')).resolves.toBeNull()
    expect(mocks.rpc).toHaveBeenCalledWith('last_webhook_event_at', { p_provider: 'resend' })
  })
})

describe('previewEmail', () => {
  it('posts the draft to email-preview with the query’s signal', async () => {
    const preview = { subject: 'Votre accès à Clinique MANA', html: '<p>Bonjour</p>', text: 'Bonjour' }
    mocks.invoke.mockResolvedValue({ data: preview, error: null })
    const signal = new AbortController().signal
    await expect(previewEmail('core.staff_invite', DRAFT, signal)).resolves.toEqual(preview)
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('email-preview', {
      body: { template_key: 'core.staff_invite', subject: 'Objet', body: 'Texte', button_label: null },
      signal,
    })
  })

  it('turns an error answer into an EmailFunctionError with its code and variable', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: httpError(400, { error: { code: 'invalid_request', message: 'Unknown variable', variable: 'client.diagnosis' } }),
    })
    const error = await previewEmail('core.staff_invite', DRAFT).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EmailFunctionError)
    expect(error).toMatchObject({ code: 'invalid_request', status: 400, message: 'Unknown variable', variable: 'client.diagnosis' })
  })

  it('reads an answer that is not the function’s JSON as internal, and a network failure as network', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(new Response('Bad gateway', { status: 502 })) })
    await expect(previewEmail('core.staff_invite', DRAFT)).rejects.toMatchObject({ code: 'internal', status: 502 })
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) })
    await expect(previewEmail('core.staff_invite', DRAFT)).rejects.toMatchObject({ code: 'network', status: 0 })
  })

  it('refuses an answer that is not a preview', async () => {
    mocks.invoke.mockResolvedValue({ data: { html: 1 }, error: null })
    await expect(previewEmail('core.staff_invite', DRAFT)).rejects.toMatchObject({ code: 'internal' })
  })
})

describe('sendTestEmail', () => {
  it('sends the draft to email-test-send, never a recipient', async () => {
    mocks.invoke.mockResolvedValue({ data: { email_log_id: LOG_ROW.id }, error: null })
    await sendTestEmail('core.staff_invite', { ...DRAFT, button_label: 'Créer mon accès' })
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('email-test-send', {
      body: { template_key: 'core.staff_invite', subject: 'Objet', body: 'Texte', button_label: 'Créer mon accès' },
    })
  })

  it('throws the function’s code (rate_limited)', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: httpError(429, { error: { code: 'rate_limited', message: 'Too many test emails' } }) })
    await expect(sendTestEmail('core.staff_invite', DRAFT)).rejects.toMatchObject({ code: 'rate_limited', status: 429 })
  })
})

describe('webhookUrl', () => {
  it('is the resend-webhook function of this project, the org as a routing hint', () => {
    expect(webhookUrl('a0000000-0000-0000-0000-000000000001')).toBe(
      'http://127.0.0.1:55321/functions/v1/resend-webhook?org=a0000000-0000-0000-0000-000000000001',
    )
  })
})

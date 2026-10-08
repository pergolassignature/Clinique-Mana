import { FunctionsHttpError } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionCallError } from '@/core/supabase/functions'
import {
  fetchSigningSettings,
  lastDocumensoEventAt,
  lastSigningTest,
  listDocumentTemplates,
  sendSigningTestDocument,
  setSigningSettings,
  syncSignatureRequest,
  testSigningConnection,
  webhookUrl,
} from './api'

const mocks = vi.hoisted(() => {
  const single = vi.fn()
  const select = vi.fn(() => ({ single }))
  return { rpc: vi.fn(), from: vi.fn(() => ({ select })), select, single, invoke: vi.fn() }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from, functions: { invoke: mocks.invoke } } }))

afterEach(() => vi.clearAllMocks())

const httpError = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } }))

const REQUEST = {
  id: 'a0000000-0000-0000-0000-000000000001',
  module_key: 'core',
  purpose: 'core.signing_test',
  title: 'Document test de signature électronique',
  status: 'sent',
  template_version_id: null,
  template_version: null,
  sent_by: 'u1',
  created_at: '2026-10-08T12:00:00+00:00',
  sent_at: '2026-10-08T12:00:05+00:00',
  viewed_at: null,
  completed_at: null,
  rejected_at: null,
  cancelled_at: null,
  expired_at: null,
  expires_at: '2026-10-15T12:00:05+00:00',
  rejection_reason: null,
  last_error: null,
  signed_file_id: null,
  signers: [{ role: 'clinic', name: 'Test', status: 'pending', signing_order: 1, viewed_at: null, signed_at: null, rejected_at: null }],
}

describe('settings', () => {
  it('reads the address and expiry of the caller’s org (RLS: own org, settings.view)', async () => {
    mocks.single.mockResolvedValue({ data: { base_url: null, expiry_days: 7 }, error: null })
    await expect(fetchSigningSettings()).resolves.toEqual({ base_url: null, expiry_days: 7 })
    expect(mocks.from).toHaveBeenCalledWith('signing_settings')
    expect(mocks.select).toHaveBeenCalledWith('base_url, expiry_days')
  })

  it('sends only the fields given, as a patch (null clears the address), and returns whether the key was cleared', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { api_key_cleared: true }, error: null }).mockResolvedValueOnce({ data: { api_key_cleared: false }, error: null })
    await expect(setSigningSettings({ base_url: 'https://sign.cliniquemana.com' })).resolves.toEqual({ api_key_cleared: true })
    await expect(setSigningSettings({ expiry_days: 14 })).resolves.toEqual({ api_key_cleared: false })
    expect(mocks.rpc.mock.calls).toEqual([
      ['set_signing_settings', { p: { base_url: 'https://sign.cliniquemana.com' } }],
      ['set_signing_settings', { p: { expiry_days: 14 } }],
    ])
  })

  it('throws the RPC error', async () => {
    const error = { code: '42501', message: 'Permission refusée' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(setSigningSettings({ base_url: null })).rejects.toBe(error)
  })

  it('refuses an unexpected answer', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(setSigningSettings({ expiry_days: 7 })).rejects.toThrow()
  })
})

describe('reads', () => {
  it('asks when the last Documenso event arrived (null: never)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(lastDocumensoEventAt()).resolves.toBeNull()
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('last_webhook_event_at', { p_provider: 'documenso' })
  })

  it('reads the caller’s last test request: one row of list_subject_signature_requests', async () => {
    mocks.rpc.mockResolvedValue({ data: [REQUEST], error: null })
    // Only what the status line reads.
    await expect(lastSigningTest('u1')).resolves.toEqual({
      id: REQUEST.id,
      status: 'sent',
      last_error: null,
      created_at: REQUEST.created_at,
      sent_at: REQUEST.sent_at,
    })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_subject_signature_requests', {
      p_subject_type: 'signing_test',
      p_subject_id: 'u1',
      p_limit: 1,
    })
  })

  it('answers null when the caller never sent a test', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await expect(lastSigningTest('u1')).resolves.toBeNull()
  })

  it('lists the document templates with their published version', async () => {
    const listed = {
      id: 'b0000000-0000-0000-0000-000000000001',
      key: 'professionals.contract',
      module_key: 'professionals',
      title: 'Contrat de service',
      description: null,
      is_active: true,
      published_version: 3,
      published_at: '2026-10-08T12:00:00+00:00',
      draft_version_id: null,
    }
    const row = {
      ...listed,
      view_permission: 'professionals.view',
      edit_permission: 'professionals.manage',
      can_edit: false,
      published_version_id: 'c0000000-0000-0000-0000-000000000001',
      updated_at: '2026-10-08T12:00:00+00:00',
    }
    mocks.rpc.mockResolvedValue({ data: [row], error: null })
    // Only what the read-only list shows.
    await expect(listDocumentTemplates()).resolves.toEqual([listed])
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_document_templates')
  })
})

describe('functions', () => {
  it('« Tester la connexion »: the function’s answer, success or Documenso’s status', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true }, error: null }).mockResolvedValueOnce({ data: { ok: false, status: 401 }, error: null })
    await expect(testSigningConnection()).resolves.toEqual({ ok: true })
    await expect(testSigningConnection()).resolves.toEqual({ ok: false, status: 401 })
    expect(mocks.invoke).toHaveBeenCalledWith('signing-test-connection', { body: {} })
  })

  it('throws a FunctionCallError for a refusal, with its code', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: httpError(503, { error: { code: 'not_configured', message: 'Signing is not configured' } }) })
    await expect(testSigningConnection()).rejects.toMatchObject({ code: 'not_configured', status: 503 })
  })

  it('« Envoyer un document test »: sends the click’s idempotency key, never an address', async () => {
    mocks.invoke.mockResolvedValue({ data: { request_id: REQUEST.id, existing: false }, error: null })
    await expect(sendSigningTestDocument('d0000000-0000-4000-8000-000000000001')).resolves.toEqual({ request_id: REQUEST.id, existing: false })
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('signing-test-document', { body: { idempotency_key: 'd0000000-0000-4000-8000-000000000001' } })
  })

  it('keeps a 429’s Retry-After', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: httpError(429, { error: { code: 'rate_limited', message: 'Too many' } }, { 'Retry-After': '600' }) })
    const error = await sendSigningTestDocument('d0000000-0000-4000-8000-000000000001').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FunctionCallError)
    expect(error).toMatchObject({ code: 'rate_limited', retryAfter: 600 })
  })

  it('« Actualiser l’état »: signing-sync in user mode', async () => {
    mocks.invoke.mockResolvedValue({ data: { request_id: REQUEST.id, outcome: 'updated' }, error: null })
    await expect(syncSignatureRequest(REQUEST.id)).resolves.toEqual({ request_id: REQUEST.id, outcome: 'updated' })
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('signing-sync', { body: { request_id: REQUEST.id } })
  })

  it('treats an unexpected answer as internal', async () => {
    mocks.invoke.mockResolvedValue({ data: { surprise: true }, error: null })
    await expect(testSigningConnection()).rejects.toMatchObject({ code: 'internal' })
  })
})

it('builds the webhook address of the org (the function checks the secret)', () => {
  expect(webhookUrl('o 1')).toBe(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/signing-webhook?org=o%201`)
})

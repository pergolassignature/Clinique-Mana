import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchConsentTemplates, fetchConsentsToObtain, saveConsentSettings, sendConsentRequest, UNEXPECTED_SHAPE } from './consents'

const mocks = vi.hoisted(() => {
  const query = { select: vi.fn(), order: vi.fn(), limit: vi.fn() }
  query.select.mockReturnValue(query)
  query.order.mockReturnValue(query)
  return { rpc: vi.fn(), from: vi.fn(() => query), query, invoke: vi.fn() }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))
vi.mock('@/core/supabase/functions', async (importOriginal) => ({ ...(await importOriginal<object>()), invokeFunction: mocks.invoke }))

afterEach(() => vi.clearAllMocks())

const template = (over: Record<string, unknown>) => ({
  id: 't1',
  key: 'clients.consent_general_fr',
  title: 'Consentement général',
  published_version: null,
  published_version_id: null,
  published_at: null,
  draft_version_id: 'd1',
  ...over,
})
const placeholderBody = { blocks: [{ type: 'paragraph', runs: [{ text: 'Texte provisoire — à faire valider par la direction avant publication.' }] }] }

describe('fetchConsentTemplates', () => {
  it('reads core’s templates of the module through the RPCs, never the tables; a placeholder draft is flagged', async () => {
    mocks.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'list_document_templates') {
        expect(args).toEqual({ p_module_key: 'clients' })
        return {
          data: [
            template({}),
            template({
              id: 't2',
              key: 'clients.consent_general_en',
              published_version: 1,
              published_version_id: 'p2',
              published_at: '2026-10-01T14:00:00Z',
              draft_version_id: 'd2',
            }),
            template({ id: 't3', key: 'clients.other_document', draft_version_id: null }),
          ],
          error: null,
        }
      }
      return args.p_template_id === 't1'
        ? { data: [{ id: 'd1', version: 1, status: 'draft', body: placeholderBody }], error: null }
        : { data: [{ id: 'p2', version: 1, status: 'published', body: {} }, { id: 'd2', version: 2, status: 'draft', body: { blocks: [] } }], error: null }
    })
    const templates = await fetchConsentTemplates()
    expect(mocks.from).not.toHaveBeenCalled()
    expect(templates).toEqual([
      { id: 't1', consentKey: 'general', language: 'fr', title: 'Consentement général', published: null, draft: { id: 'd1', version: 1, placeholder: true } },
      {
        id: 't2',
        consentKey: 'general',
        language: 'en',
        title: 'Consentement général',
        published: { id: 'p2', version: 1, publishedAt: '2026-10-01T14:00:00Z' },
        draft: { id: 'd2', version: 2, placeholder: false },
      },
    ])
  })

  it('an unexpected shape throws without Zod’s issues', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: 1 }], error: null })
    await expect(fetchConsentTemplates()).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

describe('fetchConsentsToObtain', () => {
  it('returns the rows shown and the total count', async () => {
    mocks.query.limit.mockResolvedValue({ data: [], error: null, count: 612 })
    await expect(fetchConsentsToObtain()).resolves.toEqual({ rows: [], total: 612 })
    expect(mocks.query.select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' })
    expect(mocks.query.limit).toHaveBeenCalledWith(500)
  })
})

describe('saveConsentSettings / sendConsentRequest', () => {
  it('maps the fields to the columns of set_client_consent_settings', async () => {
    mocks.rpc.mockResolvedValue({
      data: { due_days_before_first_appointment: 2, reminder_days: 7, pre_appointment_reminder_hours: 48, retention_policy: null },
      error: null,
    })
    await saveConsentSettings({ dueDays: 2, retentionPolicy: null })
    expect(mocks.rpc).toHaveBeenCalledWith('set_client_consent_settings', { p_patch: { due_days_before_first_appointment: 2, retention_policy: null } })
  })

  it('« Envoyer » calls clients-consent-send with the record as the context', async () => {
    mocks.invoke.mockResolvedValue({ request_id: 'q1', resent: false, signers: [{ role: 'client', sent: true }] })
    await sendConsentRequest('c1', 'general')
    expect(mocks.invoke).toHaveBeenCalledWith('clients-consent-send', { action: 'send', client_id: 'c1', consent_key: 'general', context_type: 'record', context_id: 'c1' })
  })
})

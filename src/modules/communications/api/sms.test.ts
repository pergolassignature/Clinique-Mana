import { afterEach, describe, expect, it, vi } from 'vitest'
import { listSmsThread, listSmsThreads, sendSms, setSmsConsent, THREAD_LIMIT, UNEXPECTED_SHAPE } from './sms'
import { fetchSmsSettings, saveSmsSettings } from './sms-settings'

const mocks = vi.hoisted(() => {
  const limit = vi.fn()
  const order = vi.fn()
  const eq = vi.fn()
  const chain = { order, limit, eq }
  order.mockReturnValue(chain)
  eq.mockReturnValue(chain)
  const select = vi.fn(() => chain)
  const from = vi.fn(() => ({ select }))
  const rpc = vi.fn()
  const invoke = vi.fn()
  return { from, select, order, limit, eq, rpc, invoke }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('@/core/supabase/functions', () => ({ invokeFunction: mocks.invoke }))

afterEach(() => vi.clearAllMocks())

const THREAD = {
  peer_e164: '+15145551234',
  last_message_at: '2027-03-10T15:00:00Z',
  last_direction: 'in',
  last_status: 'received',
  last_body: 'Bonjour',
  last_body_purged: false,
  last_has_media: false,
  message_count: 3,
  last_inbound_at: '2027-03-10T15:00:00Z',
  consent_status: 'opted_in',
}

const message = (n: number) => ({
  id: `m${n}`,
  direction: 'out',
  peer_e164: '+15145551234',
  kind: 'reply',
  body: `Texte ${n}`,
  body_purged_at: null,
  media: [],
  status: 'sent',
  error_code: null,
  send_after: null,
  created_at: `2027-03-10T15:00:${String(n % 60).padStart(2, '0')}Z`,
  sent_at: null,
})

describe('listSmsThreads', () => {
  it('reads the view newest first, without the org', async () => {
    mocks.limit.mockResolvedValue({ data: [THREAD], error: null })
    const [thread] = await listSmsThreads()
    expect(mocks.from).toHaveBeenCalledWith('sms_threads')
    expect(String((mocks.select.mock.calls[0] as unknown[])[0])).not.toContain('org_id')
    expect(mocks.order).toHaveBeenCalledWith('last_message_at', { ascending: false })
    expect(thread).toMatchObject({ phone: '+15145551234', consent: 'opted_in', messageCount: 3 })
  })

  it('throws the shape error (never Zod issues quoting a number) on an unexpected row', async () => {
    mocks.limit.mockResolvedValue({ data: [{ ...THREAD, last_status: 'weird' }], error: null })
    await expect(listSmsThreads()).rejects.toThrow(UNEXPECTED_SHAPE)
  })
})

describe('listSmsThread', () => {
  it("one number's latest texts through the RPC (never a URL filter), oldest first; truncated past the cap", async () => {
    mocks.rpc.mockResolvedValue({ data: [message(2), message(1)], error: null })
    const result = await listSmsThread('+15145551234')
    expect(mocks.rpc).toHaveBeenCalledWith('list_sms_thread', { p_phone: '+15145551234', p_limit: THREAD_LIMIT + 1 })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(result.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(result.truncated).toBe(false)

    mocks.rpc.mockResolvedValue({ data: Array.from({ length: THREAD_LIMIT + 1 }, (_, i) => message(i)), error: null })
    const long = await listSmsThread('+15145551234')
    expect(long.messages).toHaveLength(THREAD_LIMIT)
    expect(long.truncated).toBe(true)
  })
})

describe('setSmsConsent / sendSms', () => {
  it('passes the number as typed and the note only when given', async () => {
    mocks.rpc.mockResolvedValue({ data: { phone_e164: '+15145551234', status: 'opted_in' }, error: null })
    await expect(setSmsConsent({ phone: '514 555-1234', status: 'opted_in' })).resolves.toEqual({ phone: '+15145551234', status: 'opted_in' })
    expect(mocks.rpc).toHaveBeenCalledWith('set_sms_consent', { p_phone: '514 555-1234', p_status: 'opted_in' })
    await setSmsConsent({ phone: '514 555-1234', status: 'opted_out', note: 'Au téléphone' })
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_sms_consent', { p_phone: '514 555-1234', p_status: 'opted_out', p_note: 'Au téléphone' })
  })

  it('a reply goes through sms-send', async () => {
    mocks.invoke.mockResolvedValue({ sms_message_id: 'm1', status: 'sent' })
    await expect(sendSms({ to: '+15145551234', body: 'Bonjour' })).resolves.toEqual({ id: 'm1' })
    expect(mocks.invoke).toHaveBeenCalledWith('sms-send', { to: '+15145551234', body: 'Bonjour' })
  })
})

describe('the SMS settings', () => {
  const ROW = { sms_base_url: null, sms_client_id: null, sms_did: '+14185550199', sms_consent_text: 'a ARRÊT', sms_opt_out_reply: 'b' }

  it('maps the stored keys both ways', async () => {
    mocks.rpc.mockResolvedValue({ data: ROW, error: null })
    await expect(fetchSmsSettings()).resolves.toEqual({ baseUrl: null, clientId: null, did: '+14185550199', consentText: 'a ARRÊT', optOutReply: 'b' })
    await saveSmsSettings({ baseUrl: 'https://pbx.exemple.com', did: null })
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_sms_settings', { p_patch: { sms_base_url: 'https://pbx.exemple.com', sms_did: null } })
  })
})

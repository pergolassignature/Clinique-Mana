import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  disconnectMailConnection,
  fetchCommunicationsSettings,
  finishGmailConnect,
  gmailWebhookUrl,
  listMailConnections,
  saveCommunicationsSettings,
  startGmailConnect,
  syncMailConnection,
} from './mailboxes'
import { MAILBOX } from '../test/fixtures'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }))
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('@/core/supabase/functions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/supabase/functions')>()),
  invokeFunction: mocks.invoke,
}))

afterEach(() => vi.clearAllMocks())


describe('listMailConnections', () => {
  it('parses the RPC rows', async () => {
    mocks.rpc.mockResolvedValue({ data: [MAILBOX], error: null })
    await expect(listMailConnections()).resolves.toEqual([MAILBOX])
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('list_mail_connections')
  })

  it('throws the RPC error, and refuses an unknown status', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'x' } })
    await expect(listMailConnections()).rejects.toMatchObject({ code: '42501' })
    mocks.rpc.mockResolvedValueOnce({ data: [{ ...MAILBOX, status: 'weird' }], error: null })
    await expect(listMailConnections()).rejects.toThrow()
  })
})

describe('settings', () => {
  it('reads and saves the topic', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { pubsub_topic: null }, error: null })
    await expect(fetchCommunicationsSettings()).resolves.toEqual({ pubsub_topic: null })
    mocks.rpc.mockResolvedValueOnce({ data: { pubsub_topic: 'projects/mana-prod/topics/gmail' }, error: null })
    await expect(saveCommunicationsSettings({ pubsub_topic: 'projects/mana-prod/topics/gmail' })).resolves.toEqual({
      pubsub_topic: 'projects/mana-prod/topics/gmail',
    })
    expect(mocks.rpc).toHaveBeenLastCalledWith('set_communications_settings', { p_patch: { pubsub_topic: 'projects/mana-prod/topics/gmail' } })
  })
})

describe('the Gmail functions', () => {
  it('start: posts the kind and answers the consent URL', async () => {
    mocks.invoke.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x' })
    await expect(startGmailConnect()).resolves.toBe('https://accounts.google.com/o/oauth2/v2/auth?client_id=x')
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('gmail-connect', { action: 'start', kind: 'shared' })
  })

  it('start: refuses an answer that is not an http(s) URL', async () => {
    mocks.invoke.mockResolvedValue({ url: 'javascript:alert(1)' })
    await expect(startGmailConnect()).rejects.toThrow()
  })

  it('callback, sync and disconnect post their bodies', async () => {
    mocks.invoke.mockResolvedValueOnce({ connection_id: MAILBOX.id, email_address: MAILBOX.email_address })
    await expect(finishGmailConnect('4/code', 'state')).resolves.toEqual({ connection_id: MAILBOX.id, email_address: MAILBOX.email_address })
    expect(mocks.invoke).toHaveBeenLastCalledWith('gmail-callback', { code: '4/code', state: 'state' })

    mocks.invoke.mockResolvedValueOnce({ outcome: 'synced', messages: 3, attachments: 1, initial_pending: false })
    await expect(syncMailConnection(MAILBOX.id)).resolves.toMatchObject({ outcome: 'synced', messages: 3 })
    expect(mocks.invoke).toHaveBeenLastCalledWith('gmail-sync', { connection_id: MAILBOX.id })
    mocks.invoke.mockResolvedValueOnce({ outcome: 'skipped', messages: 0, attachments: 0, initial_pending: false })
    await syncMailConnection(MAILBOX.id, true)
    expect(mocks.invoke).toHaveBeenLastCalledWith('gmail-sync', { connection_id: MAILBOX.id, full: true })

    mocks.invoke.mockResolvedValueOnce({ ok: true, revoked: false })
    await expect(disconnectMailConnection(MAILBOX.id)).resolves.toEqual({ revoked: false })
    expect(mocks.invoke).toHaveBeenLastCalledWith('gmail-connect', { action: 'disconnect', connection_id: MAILBOX.id })
  })

  it('the push address names the org and a placeholder, never the token', () => {
    expect(gmailWebhookUrl('o1', 'JETON')).toMatch(/\/functions\/v1\/gmail-webhook\?org=o1&token=JETON$/)
  })
})

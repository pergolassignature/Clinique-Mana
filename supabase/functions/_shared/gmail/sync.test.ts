import { assert, assertEquals, assertFalse } from '@std/assert'
import { gmailOrigins } from './env.ts'
import {
  INITIAL_DAYS,
  type SyncContext,
  syncDetail,
  syncMailbox,
} from './sync.ts'
import {
  CONNECTION_ID,
  gmailHarness,
  initialState,
  MAILBOX,
  ORG_ID,
  TOPIC,
} from '../testing/gmail-fixtures.ts'

const PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n',
)

function setup(opts: Parameters<typeof gmailHarness>[0] = {}) {
  const h = gmailHarness(opts)
  const ctx = (over: Partial<SyncContext> = {}): SyncContext => ({
    client: h.service.client,
    fetch: h.google.fetch,
    origins: gmailOrigins(h.deps.env),
    now: h.deps.now,
    orgId: ORG_ID,
    signal: new AbortController().signal,
    softDeadline: Date.now() + 30_000,
    pubsubTopic: TOPIC,
    ...over,
  })
  const mailbox = () => ({
    connection_id: CONNECTION_ID,
    email_address: MAILBOX,
    status: 'connected',
    history_id: h.state.sync.history_id === null
      ? null
      : Number(h.state.sync.history_id),
    sync_requested_at: null,
    last_sync_at: null,
    initial_sync_done: h.state.sync.initial_sync_done,
    initial_sync_page_token: h.state.sync.initial_sync_page_token,
    watch_expires_at: h.state.sync.watch_expires_at,
    lease_until: null,
  })
  return { ...h, ctx, mailbox }
}

Deno.test('sync: the first pass reads the profile before listing, writes every message (bodies, attachments, labels) and sets the watch', async () => {
  const s = setup()
  const first = s.google.deliver({
    from: 'Amélie <amelie@example.test>',
    subject: 'Demande',
    text: 'Bonjour',
  })
  s.google.deliver({
    from: `Clinique <${MAILBOX}>`,
    to: 'amelie@example.test',
    subject: 'Re: Demande',
    text: 'Avec plaisir',
    threadId: first.threadId,
    labelIds: ['SENT'],
  })
  s.google.deliver({
    from: 'Marc <marc@example.test>',
    subject: 'Formulaire',
    text: 'Ci-joint',
    attachments: [
      { filename: 'formulaire.pdf', mimeType: 'application/pdf', bytes: PDF },
      {
        filename: 'archive.zip',
        mimeType: 'application/zip',
        bytes: new Uint8Array([1, 2, 3]),
      },
    ],
  })
  const historyBefore = s.google.historyId
  const outcome = await syncMailbox(s.ctx(), s.mailbox())
  assertEquals(outcome.status, 'ok')
  assertEquals(outcome.messages, 3)
  assertEquals(outcome.attachments, 1)
  assertFalse(outcome.initialPending)
  // Google was asked in the order: profile, labels… (the profile's history id anchors the pass).
  const paths = s.google.calls.map((c) =>
    c.path.replace('/gmail/v1/users/me/', '')
  )
  assert(paths.indexOf('profile') < paths.indexOf('messages'), paths.join(' '))
  assert(
    paths[0] === 'labels' || paths[1] === 'labels' || paths[0] === 'profile',
  )
  assertEquals(paths.filter((p) => p === 'messages').length, 1, 'one list page')
  // The rows: addresses lower-cased, bodies present, the zip listed as not accepted.
  const rows = s.state.upserted
  assertEquals(rows.map((r) => r.gmail_message_id).sort(), [
    'm000001',
    'm000002',
    'm000003',
  ])
  const sent = rows.find((r) => r.gmail_message_id === 'm000002')!
  assertEquals(sent.from_address, MAILBOX)
  assertEquals(sent.label_ids, ['SENT'])
  assert(String(sent.body_html).includes('Avec plaisir'))
  const withFiles = rows.find((r) => r.gmail_message_id === 'm000003')!
  assertEquals(
    (withFiles.attachments as { accepted: boolean }[]).map((a) => a.accepted),
    [true, false],
  )
  // The attachment: registered, uploaded with its bytes, recorded stored.
  assertEquals(s.uploads.map((u) => [u.bucket, u.contentType, u.size]), [[
    'documents',
    'application/pdf',
    PDF.byteLength,
  ]])
  assertEquals(s.state.attachments.map((a) => a.status), ['stored'])
  assertEquals(s.state.files[0].name, 'formulaire.pdf')
  // The state: history id = the profile's at the start, the first pass done, the watch set, the labels written.
  assertEquals(s.state.sync.history_id, historyBefore)
  assert(s.state.sync.initial_sync_done)
  assertEquals(s.state.sync.last_status, 'ok')
  assertEquals(s.google.watch?.topicName, TOPIC)
  assert(s.state.sync.watch_expires_at !== null)
  assertEquals(s.state.labels.length, s.google.labels.length)
  assertEquals(s.state.sync.lease_token, null, 'the lease is released')
})

Deno.test('sync: a first pass cut by the time budget saves its page token and resumes', async () => {
  const s = setup()
  for (let i = 0; i < 5; i++) {
    s.google.deliver({
      from: `p${i}@example.test`,
      subject: `Sujet ${i}`,
      text: 'x',
    })
  }
  // Two ids per page: the budget allows one page per pass.
  const origListMessages = s.google.handler
  const pageOf2 = async (req: Request) => {
    const url = new URL(req.url)
    if (url.pathname.endsWith('/messages') && req.method === 'GET') {
      url.searchParams.set('maxResults', '2')
    }
    return await origListMessages(new Request(url, req))
  }
  const fetchFn =
    ((input: RequestInfo | URL, init?: RequestInit) =>
      pageOf2(new Request(input, init))) as typeof fetch
  let calls = 0
  const budgetAfterOnePage =
    () => (calls++ < 1 ? Date.now() + 30_000 : Date.now() - 1)
  const ctx = s.ctx({ fetch: fetchFn })
  // The soft deadline is read as a number: emulate « one page then out of budget » by a getter.
  Object.defineProperty(ctx, 'softDeadline', { get: budgetAfterOnePage })
  const first = await syncMailbox(ctx, s.mailbox())
  assertEquals(first.status, 'ok')
  assert(first.initialPending)
  assertEquals(first.messages, 2)
  assertEquals(s.state.sync.initial_sync_page_token, '2')
  assertFalse(s.state.sync.initial_sync_done)
  const second = await syncMailbox(s.ctx({ fetch: fetchFn }), s.mailbox())
  assertEquals(second.status, 'ok')
  assertFalse(second.initialPending)
  assertEquals(second.messages, 3)
  assert(s.state.sync.initial_sync_done)
  assertEquals(s.state.upserted.length, 5)
})

Deno.test('sync: the incremental pass applies deletions, label changes and additions from the history, and advances to the last record applied', async () => {
  const s = setup()
  const a = s.google.deliver({
    from: 'a@example.test',
    subject: 'A',
    text: 'a',
  })
  const b = s.google.deliver({
    from: 'b@example.test',
    subject: 'B',
    text: 'b',
  })
  await syncMailbox(s.ctx(), s.mailbox())
  const afterFirst = s.state.sync.history_id!
  s.state.upserted.length = 0
  // Changes since: A read and archived, B deleted, C arrives.
  const url = `http://fake-google.test/gmail/v1/users/me/messages/batchModify`
  await s.google.fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.state.connection!.access}` },
    body: JSON.stringify({ ids: [a.id], removeLabelIds: ['UNREAD', 'INBOX'] }),
  })
  s.google.messages.delete(b.id)
  s.google.history.push({
    id: String(Number(s.google.historyId) + 1),
    messagesDeleted: [{ message: { id: b.id, threadId: b.threadId } }],
  })
  const c = s.google.deliver({
    from: 'c@example.test',
    subject: 'C',
    text: 'c',
  })
  s.google.calls.length = 0
  const outcome = await syncMailbox(s.ctx(), s.mailbox())
  assertEquals(outcome.status, 'ok')
  assertEquals(outcome.messages, 1)
  assertEquals(outcome.deleted, 1)
  assertEquals(s.state.deleted, [b.id])
  assertEquals(s.state.labelChanges, [{
    gmail_message_id: a.id,
    add: [],
    remove: ['UNREAD', 'INBOX'],
  }])
  assertEquals(s.state.upserted.map((r) => r.gmail_message_id), [c.id])
  // Only C was fetched in full (A's labels came from the record).
  const gets = s.google.calls.filter((x) => /messages\/m\d+$/.test(x.path))
  assertEquals(gets.map((x) => x.path.split('/').pop()), [c.id])
  assert(BigInt(s.state.sync.history_id!) > BigInt(afterFirst))
  assertEquals(s.state.sync.history_id, s.google.history.at(-1)!.id)
})

Deno.test('sync: a start id Google no longer has (404) forgets the history and runs the first pass again', async () => {
  const s = setup()
  s.google.deliver({ from: 'a@example.test', subject: 'A', text: 'a' })
  s.state.sync.history_id = '1'
  s.state.sync.initial_sync_done = true
  const outcome = await syncMailbox(s.ctx(), s.mailbox())
  assertEquals(outcome.status, 'ok')
  assertEquals(outcome.messages, 1)
  assert(s.rpcNames().includes('reset_mail_history'))
  assertEquals(s.state.sync.history_id, s.google.historyId)
})

Deno.test('sync: a mailbox under another lease is skipped, nothing read', async () => {
  const s = setup()
  s.state.sync.lease_token = '00000000-0000-4000-8000-00000000beef'
  s.state.sync.lease_until = Date.parse('2026-10-12T15:04:00.000Z')
  const outcome = await syncMailbox(s.ctx(), s.mailbox())
  assertEquals(outcome.status, 'skipped')
  assertEquals(s.google.calls.length, 0)
  assertEquals(s.rpcNames(), ['acquire_mail_sync_lease'])
})

Deno.test('sync: an expired access token is refreshed and stored; a revoked grant marks the mailbox needs_reconnect', async () => {
  const s = setup()
  s.state.connection!.expiresAt = '2026-10-12T15:02:00.000Z'
  await syncMailbox(s.ctx(), s.mailbox())
  assert(s.state.connection!.access !== 'ya29.initial', 'refreshed')
  assert(s.rpcNames().includes('set_mail_access_token'))
  assertEquals(s.state.connection!.status, 'connected')

  s.google.grants.get(s.state.connection!.refresh)!.revoked = true
  s.state.connection!.expiresAt = '2026-10-12T15:02:00.000Z'
  const outcome = await syncMailbox(s.ctx(), s.mailbox())
  assertEquals(outcome.status, 'needs_reconnect')
  assertEquals(outcome.code, 'invalid_grant')
  assertEquals([s.state.connection!.status, s.state.connection!.reason], [
    'needs_reconnect',
    'invalid_grant',
  ])
  assertEquals(s.state.sync.last_error, 'invalid_grant')
  assertEquals(s.state.sync.lease_token, null)
})

Deno.test('sync: a grant without gmail.modify is needs_reconnect (scope_missing)', async () => {
  const s = setup()
  s.state.connection!.scopes = ['https://www.googleapis.com/auth/gmail.send']
  const outcome = await syncMailbox(s.ctx(), s.mailbox())
  assertEquals([outcome.status, outcome.code], [
    'needs_reconnect',
    'scope_missing',
  ])
  assertEquals(s.state.connection!.reason, 'scope_missing')
})

Deno.test('sync: an attachment whose bytes are not what it declares is not copied; a missing OAuth application is not_configured', async () => {
  const s = setup()
  s.google.deliver({
    from: 'x@example.test',
    subject: 'Faux PDF',
    text: 'x',
    attachments: [{
      filename: 'page.pdf',
      mimeType: 'application/pdf',
      bytes: new TextEncoder().encode('<html><script>alert(1)</script></html>'),
    }],
  })
  await syncMailbox(s.ctx(), s.mailbox())
  assertEquals(s.uploads.length, 0)
  assertEquals(s.state.attachments.map((a) => a.status), ['unsupported_type'])

  const t = setup({
    state: initialState({
      secrets: {
        google_oauth_client_id: null,
        google_oauth_client_secret: null,
        gmail_pubsub_token: null,
      },
    }),
  })
  const outcome = await syncMailbox(t.ctx(), t.mailbox())
  assertEquals([outcome.status, outcome.code], ['error', 'not_configured'])
})

Deno.test('sync: Google down is an error with a gmail_ code, the lease released and the history kept', async () => {
  const s = setup()
  s.google.deliver({ from: 'a@example.test', subject: 'A', text: 'a' })
  await syncMailbox(s.ctx(), s.mailbox())
  const kept = s.state.sync.history_id
  const down = (() =>
    Promise.reject(
      new TypeError('connection refused'),
    )) as unknown as typeof fetch
  const outcome = await syncMailbox(s.ctx({ fetch: down }), s.mailbox())
  assertEquals(outcome.status, 'error')
  assertEquals(outcome.code, 'gmail_unreachable')
  assertEquals(s.state.sync.history_id, kept)
  assertEquals(s.state.sync.lease_token, null)
})

Deno.test('sync: the watch is renewed only when missing or expiring within 2 days, and only with a topic', async () => {
  const s = setup()
  s.state.sync.watch_expires_at = '2026-10-18T15:00:00.000Z'
  s.state.sync.initial_sync_done = true
  s.state.sync.history_id = s.google.historyId
  const kept = await syncMailbox(s.ctx(), s.mailbox())
  assertFalse(kept.watchRenewed)
  s.state.sync.watch_expires_at = '2026-10-13T15:00:00.000Z'
  const renewed = await syncMailbox(s.ctx(), s.mailbox())
  assert(renewed.watchRenewed)
  s.state.sync.watch_expires_at = null
  const noTopic = await syncMailbox(s.ctx({ pubsubTopic: null }), s.mailbox())
  assertFalse(noTopic.watchRenewed)
})

Deno.test('sync: the run detail counts only', () => {
  assertEquals(
    syncDetail([
      {
        connectionId: 'a',
        status: 'ok',
        messages: 12,
        deleted: 0,
        attachments: 1,
        initialPending: false,
        watchRenewed: false,
      },
      {
        connectionId: 'b',
        status: 'skipped',
        messages: 0,
        deleted: 0,
        attachments: 0,
        initialPending: false,
        watchRenewed: false,
      },
      {
        connectionId: 'c',
        status: 'needs_reconnect',
        code: 'invalid_grant',
        messages: 0,
        deleted: 0,
        attachments: 0,
        initialPending: false,
        watchRenewed: false,
      },
    ]),
    '3 boîtes : 12 messages, 1 pièce jointe, 1 déjà en cours, 1 à reconnecter',
  )
  assertEquals(INITIAL_DAYS, 45)
})

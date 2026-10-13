import { assert, assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  CONNECTION_ID,
  gmailHarness,
  MAILBOX,
} from '../_shared/testing/gmail-fixtures.ts'
import type {
  RpcRoute,
  StorageRoute,
} from '../_shared/testing/fake-supabase.ts'

const URL_ = 'http://fn.test/functions/v1/gmail-send'
const SEND_KEY = '00000000-0000-4000-8000-0000000000a1'
const SEND_ID = '00000000-0000-4000-8000-0000000000b1'
const THREAD = '00000000-0000-4000-8000-0000000000f1'
const FILE = '00000000-0000-4000-8000-0000000000c1'

const post = (body: unknown, token: string | null = 'tok') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  }, fn)

const body = (over: Record<string, unknown> = {}) => ({
  send_key: SEND_KEY,
  connection_id: CONNECTION_ID,
  mode: 'reply',
  thread_id: THREAD,
  to: ['alice@exemple.test'],
  subject: 'Re: Rendez-vous',
  body_html: '<p>Bonjour {{person.first_name}},</p><p>{{sender.name}}</p>',
  ...over,
})

/** What prepare_mail_send answers for a reply in the fake mailbox's thread. */
const prepared = (
  gmailThreadId: string | null,
  over: Record<string, unknown> = {},
) => ({
  send_id: SEND_ID,
  already_sent: false,
  from_name: 'Clinique MANA',
  from_address: MAILBOX,
  to: ['alice@exemple.test'],
  cc: [],
  bcc: [],
  subject: 'Re: Rendez-vous',
  gmail_thread_id: gmailThreadId,
  in_reply_to: '<m1@exemple.test>',
  references: '<m1@exemple.test>',
  values: {
    'person.first_name': 'Alice',
    'person.last_name': 'Envoi',
    'clinic.name': 'Clinique MANA',
    'sender.name': 'Julie Gagnon',
  },
  files: [],
  ...over,
})

function setup(
  opts: {
    prepare?: RpcRoute
    storage?: Record<string, StorageRoute>
    permissions?: string[]
    scopes?: string[]
  } = {},
) {
  let threadId: string | null = null
  const h = gmailHarness({
    permissions: opts.permissions ?? ['communications.inbox'],
    rpc: {
      prepare_mail_send: opts.prepare ?? (() => ({ data: prepared(threadId) })),
      complete_mail_send: (args) => ({
        data: args.p_status === 'sent' ? THREAD : null,
      }),
    },
    storage: opts.storage,
  })
  if (opts.scopes) {
    for (const g of h.google.grants.values()) g.scopes = opts.scopes
  }
  const first = h.google.deliver({
    from: 'Alice <alice@exemple.test>',
    subject: 'Rendez-vous',
    text: 'Bonjour',
  })
  threadId = first.threadId
  return h
}

const decoder = new TextDecoder()
const decodedParts = (raw: string) =>
  [...raw.matchAll(
    /Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g,
  )].map((m) =>
    decoder.decode(
      Uint8Array.from(
        atob(m[1].replaceAll('\r\n', '')),
        (c) => c.charCodeAt(0),
      ),
    )
  )

Deno.test('gmail-send: gates — method, session, permission, body', () =>
  run(async () => {
    const h = setup()
    const handler = createHandler(h.deps)
    assertEquals(
      (await handler(new Request(URL_, { method: 'GET' }))).status,
      405,
    )
    assertEquals((await handler(post(body(), null))).status, 401)
    assertEquals(
      (await createHandler(setup({ permissions: ['communications.sms'] }).deps)(
        post(body()),
      )).status,
      403,
    )
    for (
      const bad of [
        body({ send_key: 'x' }),
        body({ mode: 'broadcast' }),
        body({ file_ids: Array.from({ length: 11 }, () => FILE) }),
        body({ attachment_url: 'https://x.test/a.pdf' }),
      ]
    ) {
      assertEquals((await handler(post(bad))).status, 400)
    }
    assertFalse(h.rpcNames().includes('prepare_mail_send'))
  }))

Deno.test('gmail-send: a reply goes in its thread with its headers, the values filled; mirrored, then closed', () =>
  run(async () => {
    const h = setup()
    const res = await createHandler(h.deps)(post(body()))
    assertEquals(res.status, 200)
    const answer = await res.json()
    assertEquals(answer.status, 'sent')
    assertEquals(answer.thread_id, THREAD)
    assertEquals(h.google.sent.length, 1)
    const sent = h.google.sent[0]
    assertEquals(sent.threadId, [...h.google.messages.values()][0].threadId)
    assert(sent.raw.includes('In-Reply-To: <m1@exemple.test>\r\n'))
    assert(sent.raw.includes('To: alice@exemple.test\r\n'))
    assert(sent.raw.includes('From: "Clinique MANA" <info@clinique.test>\r\n'))
    const [text, html] = decodedParts(sent.raw)
    assertEquals(text, 'Bonjour Alice,\nJulie Gagnon')
    assert(html.includes('<p>Bonjour Alice,</p>'))
    // The sent message is in the mirror at once.
    assert(
      h.state.upserted.some((m) =>
        m.gmail_message_id === answer.gmail_message_id
      ),
    )
    const close = h.service.calls.find((c) => c.fn === 'complete_mail_send')!
    assertEquals(close.args.p_status, 'sent')
    assertEquals(close.args.p_gmail_message_id, answer.gmail_message_id)
    const prepare = h.service.calls.find((c) => c.fn === 'prepare_mail_send')!
    // The org and the actor come from the verified session, never from the body.
    assert(
      typeof prepare.args.p_org_id === 'string' &&
        typeof prepare.args.p_actor === 'string',
    )
    assertEquals(
      (prepare.args.p_send as { send_key: string }).send_key,
      SEND_KEY,
    )
    assertEquals(
      h.service.calls.filter((c) => c.fn === 'consume_rate_limit').map((c) =>
        c.args.p_bucket
      ),
      ['gmail.send_user', 'gmail.send_org_day'],
    )
  }))

Deno.test('gmail-send: the same « Envoyer » again answers what the first did, without a second send', () =>
  run(async () => {
    const h = setup({
      prepare: () => ({
        data: {
          send_id: SEND_ID,
          already_sent: true,
          gmail_message_id: 'm000009',
          gmail_thread_id: 't1',
        },
      }),
    })
    const res = await createHandler(h.deps)(post(body()))
    assertEquals(res.status, 200)
    assertEquals((await res.json()).gmail_message_id, 'm000009')
    assertEquals(h.google.sent.length, 0)
    assertFalse(h.rpcNames().includes('complete_mail_send'))
  }))

Deno.test('gmail-send: a refusal of the database (P3-40, a placeholder) is passed on as written', () =>
  run(async () => {
    const h = setup({
      prepare: () => ({
        error: {
          code: 'P0001',
          message:
            'Le module est réservé aux testeurs : un courriel à une personne hors de la clinique ne peut pas encore partir.',
        },
      }),
    })
    const res = await createHandler(h.deps)(post(body()))
    assertEquals(res.status, 400)
    const json = await res.json()
    assertEquals(json.error.refusal, true)
    assert(
      String(json.error.message).startsWith(
        'Le module est réservé aux testeurs',
      ),
    )
    assertEquals(h.google.sent.length, 0)
  }))

Deno.test('gmail-send: attachments from our storage go along; one that cannot be read fails the send', () =>
  run(async () => {
    const pdf = new TextEncoder().encode('%PDF-1.4 fictif')
    const file = {
      id: FILE,
      bucket: 'documents',
      object_path: `o/communications/s/${FILE}.pdf`,
      name: 'reçu.pdf',
      mime_type: 'application/pdf',
      size_bytes: pdf.byteLength,
    }
    const ok = setup({
      prepare: () => ({
        data: prepared(null, { files: [file], gmail_thread_id: null }),
      }),
      storage: { download: () => ({ data: new Blob([pdf]) }) },
    })
    let res = await createHandler(ok.deps)(
      post(body({ mode: 'new', thread_id: null, file_ids: [FILE] })),
    )
    assertEquals(res.status, 200)
    assert(ok.google.sent[0].raw.includes(`filename*=UTF-8''re%C3%A7u.pdf`))
    assertEquals(ok.google.sent[0].threadId, null)
    assertEquals(
      ok.service.storageCalls.map((c) => [c.bucket, c.method, c.args[0]]),
      [['documents', 'download', file.object_path]],
    )

    const missing = setup({
      prepare: () => ({ data: prepared(null, { files: [file] }) }),
      storage: {
        download: () => ({
          data: null,
          error: { message: 'Object not found' },
        }),
      },
    })
    res = await createHandler(missing.deps)(post(body({ file_ids: [FILE] })))
    assertEquals(res.status, 500)
    assertEquals(missing.google.sent.length, 0)
    const close = missing.service.calls.find((c) =>
      c.fn === 'complete_mail_send'
    )!
    assertEquals([close.args.p_status, close.args.p_error_code], [
      'failed',
      'attachment_unavailable',
    ])
  }))

Deno.test('gmail-send: Gmail refuses (no send scope) → 502, the send marked failed, never retried', () =>
  run(async () => {
    const h = setup({
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    })
    const res = await createHandler(h.deps)(post(body()))
    assertEquals(res.status, 502)
    assertEquals((await res.json()).error.code, 'provider_error')
    assertEquals(
      h.google.calls.filter((c) => c.path.endsWith('/messages/send')).length,
      1,
    )
    const close = h.service.calls.find((c) => c.fn === 'complete_mail_send')!
    assertEquals([close.args.p_status, close.args.p_error_code], [
      'failed',
      'gmail_forbidden',
    ])
  }))

Deno.test('gmail-send: a mailbox Google no longer accepts → 409, nothing sent', () =>
  run(async () => {
    const h = setup()
    for (const g of h.google.grants.values()) g.revoked = true
    h.state.connection!.expiresAt = '2026-10-12T14:00:00.000Z'
    const res = await createHandler(h.deps)(post(body()))
    assertEquals(res.status, 409)
    assertEquals(h.google.sent.length, 0)
    const close = h.service.calls.find((c) => c.fn === 'complete_mail_send')!
    assertEquals(close.args.p_error_code, 'needs_reconnect')
  }))

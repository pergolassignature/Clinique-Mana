import { assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  CONNECTION_ID,
  gmailHarness,
} from '../_shared/testing/gmail-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/gmail-modify'
const THREAD = '00000000-0000-4000-8000-0000000000f1'
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

/** A harness whose mailbox holds one unread thread of two messages, as the RPC answers it. */
function setup(perms = ['communications.inbox']) {
  // `rows` reads the harness's fake mailbox when the RPC is called, after both exist.
  const h = gmailHarness({
    permissions: perms,
    rpc: { get_mail_threads_for_action: () => ({ data: rows() }) },
  })
  const rows = () => {
    const ms = [...h.google.messages.values()]
    return [{
      thread_id: THREAD,
      connection_id: CONNECTION_ID,
      gmail_thread_id: ms[0].threadId,
      messages: ms.map((m) => ({
        gmail_message_id: m.id,
        label_ids: m.labelIds,
      })),
    }]
  }

  const first = h.google.deliver({
    from: 'a@example.test',
    subject: 'A',
    text: 'a',
    labelIds: ['INBOX', 'UNREAD'],
  })
  h.google.deliver({
    from: 'b@example.test',
    subject: 'Re: A',
    text: 'b',
    threadId: first.threadId,
    labelIds: ['INBOX', 'UNREAD'],
  })
  return h
}

Deno.test('gmail-modify: gates — method, session, permission, body', () =>
  run(async () => {
    const h = setup()
    const handler = createHandler(h.deps)
    assertEquals(
      (await handler(new Request(URL_, { method: 'GET' }))).status,
      405,
    )
    assertEquals(
      (await handler(
        post({ thread_ids: [THREAD], action: { kind: 'read' } }, null),
      ))
        .status,
      401,
    )
    const denied = createHandler(setup(['communications.sms']).deps)
    assertEquals(
      (await denied(post({ thread_ids: [THREAD], action: { kind: 'read' } })))
        .status,
      403,
    )
    for (
      const bad of [
        { thread_ids: [], action: { kind: 'read' } },
        { thread_ids: ['x'], action: { kind: 'read' } },
        { thread_ids: [THREAD], action: { kind: 'delete' } },
        { thread_ids: [THREAD], action: { kind: 'label', label_id: 'TRASH' } },
        { thread_ids: [THREAD], action: { kind: 'read' }, extra: 1 },
      ]
    ) {
      assertEquals((await handler(post(bad))).status, 400)
    }
    assertFalse(h.rpcNames().includes('get_mail_threads_for_action'))
  }))

Deno.test('gmail-modify: read asks Gmail first, then records the change in the mirror', () =>
  run(async () => {
    const h = setup()
    const res = await createHandler(h.deps)(
      post({ thread_ids: [THREAD], action: { kind: 'read' } }),
    )
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { changed: 1 })
    assertEquals(
      h.google.calls.map((c) => c.path).filter((p) =>
        p.includes('batchModify')
      ),
      ['/gmail/v1/users/me/messages/batchModify'],
    )
    for (const m of h.google.messages.values()) {
      assertFalse(m.labelIds.includes('UNREAD'))
    }
    assertEquals(h.state.labelChanges.length, 2)
    const actor = h.service.calls.find((c) =>
      c.fn === 'get_mail_threads_for_action'
    )!
    assertEquals(actor.args.p_thread_ids, [THREAD])
    assertEquals(
      h.service.calls.filter((c) => c.fn === 'consume_rate_limit')[0].args
        .p_bucket,
      'gmail.modify_user',
    )
  }))

Deno.test('gmail-modify: archive modifies the thread; a no-op asks nothing; an unknown thread is 404', () =>
  run(async () => {
    const h = setup()
    const handler = createHandler(h.deps)
    let res = await handler(
      post({ thread_ids: [THREAD], action: { kind: 'archive' } }),
    )
    assertEquals(await res.json(), { changed: 1 })
    assertEquals(
      h.google.calls.filter((c) => c.path.endsWith('/modify')).length,
      1,
    )
    for (const m of h.google.messages.values()) {
      assertFalse(m.labelIds.includes('INBOX'))
    }
    h.google.calls.length = 0
    res = await handler(
      post({ thread_ids: [THREAD], action: { kind: 'archive' } }),
    )
    assertEquals(await res.json(), { changed: 0 })
    assertEquals(
      h.google.calls.filter((c) => c.path.startsWith('/gmail/')).length,
      0,
    )

    const none = gmailHarness({
      permissions: ['communications.inbox'],
      rpc: { get_mail_threads_for_action: { data: [] } },
    })
    res = await createHandler(none.deps)(
      post({ thread_ids: [THREAD], action: { kind: 'read' } }),
    )
    assertEquals(res.status, 404)
  }))

Deno.test('gmail-modify: a revoked grant is a 409; Google down is a 502, reported, the mirror untouched', () =>
  run(async () => {
    const h = setup()
    h.google.grants.get(h.state.connection!.refresh)!.revoked = true
    h.state.connection!.expiresAt = '2026-10-12T15:01:00.000Z'
    let res = await createHandler(h.deps)(
      post({ thread_ids: [THREAD], action: { kind: 'read' } }),
    )
    assertEquals([res.status, (await res.json()).error.code], [
      409,
      'conflict',
    ])

    const down = setup()
    const realFetch = down.deps.fetch
    down.deps.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      return url.includes('batchModify')
        ? Promise.reject(new TypeError('refused'))
        : realFetch(input, init)
    }) as typeof fetch
    const errors = await captureConsole('error', async () => {
      res = await createHandler(down.deps)(
        post({ thread_ids: [THREAD], action: { kind: 'read' } }),
      )
    })
    assertEquals(res.status, 502)
    assertEquals(down.state.labelChanges.length, 0)
    assertFalse(JSON.stringify(errors).includes('@example.test'))
  }))

import { assertEquals, assertFalse } from '@std/assert'
import { createHandler } from './handler.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  CONNECTION_ID,
  gmailHarness,
  NOW,
} from '../_shared/testing/gmail-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/gmail-search'
const DAY = 86_400_000
const now = Date.parse(NOW)
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

/**
 * A harness whose RPC answers as the database would: the mirror holds the threads given, plus every
 * thread an open copied (`upsert_mail_messages`); `refuse` answers the actor check's 42501.
 */
function setup(
  opts: { perms?: string[]; held?: string[]; refuse?: boolean } = {},
) {
  const asked: string[][] = []
  const h = gmailHarness({
    permissions: opts.perms ?? ['communications.inbox'],
    rpc: {
      get_mail_search_threads_for_service: (args) => {
        const ids =
          (args as { p_gmail_thread_ids: string[] }).p_gmail_thread_ids
        asked.push(ids)
        if (opts.refuse) {
          return { error: { code: '42501', message: 'Permission refusée' } }
        }
        const inMirror = new Set([
          ...(opts.held ?? []),
          ...h.state.upserted.map((row) => row.gmail_thread_id as string),
        ])
        return {
          data: ids.filter((id) => inMirror.has(id)).map((id) => ({
            gmail_thread_id: id,
            thread_id: `mirror-${id}`,
          })),
        }
      },
    },
  })
  const gmailCalls = () =>
    h.google.calls.map((c) => c.path).filter((p) => p.startsWith('/gmail/'))
  return { h, asked, gmailCalls }
}

Deno.test('gmail-search: gates — method, session, permission, body; nothing is asked before them', () =>
  run(async () => {
    const { h, asked } = setup()
    const handler = createHandler(h.deps)
    assertEquals(
      (await handler(new Request(URL_, { method: 'GET' }))).status,
      405,
    )
    assertEquals(
      (await handler(
        post({
          action: 'search',
          connection_id: CONNECTION_ID,
          query: 'facture',
        }, null),
      )).status,
      401,
    )
    const denied = createHandler(
      setup({ perms: ['communications.sms'] }).h.deps,
    )
    assertEquals(
      (await denied(
        post({
          action: 'search',
          connection_id: CONNECTION_ID,
          query: 'facture',
        }),
      )).status,
      403,
    )
    for (
      const bad of [
        { action: 'search', connection_id: CONNECTION_ID, query: 'a' },
        {
          action: 'search',
          connection_id: CONNECTION_ID,
          query: 'x'.repeat(201),
        },
        { action: 'search', connection_id: 'x', query: 'facture' },
        { action: 'find', connection_id: CONNECTION_ID, query: 'facture' },
        {
          action: 'open',
          connection_id: CONNECTION_ID,
          gmail_thread_id: 'a/b',
        },
        {
          action: 'search',
          connection_id: CONNECTION_ID,
          query: 'facture',
          extra: 1,
        },
      ]
    ) {
      assertEquals((await handler(post(bad))).status, 400)
    }
    assertEquals(asked.length, 0)
  }))

Deno.test('gmail-search: a search finds what the mirror cannot — older mail, a word in the text — within 24 months, and writes nothing', () =>
  run(async () => {
    const held: string[] = []
    const { h, gmailCalls } = setup({ held })
    // Older than the mirror's 45 days, the word in its text only.
    const older = h.google.deliver({
      from: 'Alice Exemple <alice@exemple.test>',
      subject: 'Suivi',
      text: 'Voici la facture de mars.',
      at: now - 400 * DAY,
    })
    // Older than the 24 months: left to Gmail.
    h.google.deliver({
      from: 'bob@exemple.test',
      subject: 'Facture 2024',
      text: 'x',
      at: now - 800 * DAY,
    })
    // Already in the mirror: the list shows it already.
    held.push(
      h.google.deliver({
        from: 'carl@exemple.test',
        subject: 'Facture d’octobre',
        text: 'y',
        at: now - 2 * DAY,
      }).threadId,
    )
    h.google.deliver({
      from: 'dan@exemple.test',
      subject: 'Autre chose',
      text: 'rien',
      at: now - 3 * DAY,
    })
    const res = await createHandler(h.deps)(
      post({
        action: 'search',
        connection_id: CONNECTION_ID,
        query: 'facture',
      }),
    )
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.threads, [{
      gmail_thread_id: older.threadId,
      subject: 'Suivi',
      from_name: 'Alice Exemple',
      from_address: 'alice@exemple.test',
      date: new Date(now - 400 * DAY).toISOString(),
      snippet: older.snippet,
    }])
    // Nothing reached the mirror.
    assertEquals(h.state.upserted, [])
    // A list, then one metadata read for the one thread left; never a thread copied.
    const calls = gmailCalls()
    assertEquals(
      calls.filter((p) => p === '/gmail/v1/users/me/messages').length,
      1,
    )
    assertEquals(
      calls.filter((p) => p === `/gmail/v1/users/me/messages/${older.id}`)
        .length,
      1,
    )
    assertFalse(calls.some((p) => p.includes('/threads/')))
  }))

Deno.test('gmail-search: a search Gmail finds nothing for answers an empty list, after the actor check only', () =>
  run(async () => {
    const { h, asked } = setup()
    h.google.deliver({
      from: 'a@exemple.test',
      subject: 'Bonjour',
      text: 'x',
      at: now - DAY,
    })
    const res = await createHandler(h.deps)(
      post({
        action: 'search',
        connection_id: CONNECTION_ID,
        query: 'introuvable',
      }),
    )
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { threads: [] })
    assertEquals(asked, [[]])
  }))

Deno.test('gmail-search: a caller who may not read the mailbox is refused before anything reaches Gmail', () =>
  run(async () => {
    const { h, gmailCalls } = setup({ refuse: true })
    for (
      const body of [
        { action: 'search', connection_id: CONNECTION_ID, query: 'facture' },
        {
          action: 'open',
          connection_id: CONNECTION_ID,
          gmail_thread_id: 't000001',
        },
      ]
    ) {
      assertEquals((await createHandler(h.deps)(post(body))).status, 403)
    }
    assertEquals(gmailCalls(), [])
    assertEquals(h.state.upserted, [])
  }))

Deno.test('gmail-search: opening a hit copies its messages within 24 months into the mirror, then answers its id', () =>
  run(async () => {
    const { h } = setup()
    const old = h.google.deliver({
      from: 'a@exemple.test',
      subject: 'Facture',
      text: 'x',
      at: now - 800 * DAY,
    })
    const reply = h.google.deliver({
      from: 'info@clinique.test',
      subject: 'Re: Facture',
      text: 'y',
      threadId: old.threadId,
      at: now - 400 * DAY,
    })
    const res = await createHandler(h.deps)(
      post({
        action: 'open',
        connection_id: CONNECTION_ID,
        gmail_thread_id: old.threadId,
      }),
    )
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { thread_id: `mirror-${old.threadId}` })
    // Only the message within the window, as the purge would keep it.
    assertEquals(h.state.upserted.map((row) => row.gmail_message_id), [
      reply.id,
    ])
  }))

Deno.test('gmail-search: opening a thread the mirror already holds copies nothing', () =>
  run(async () => {
    const held: string[] = []
    const { h, gmailCalls } = setup({ held })
    const m = h.google.deliver({
      from: 'a@exemple.test',
      subject: 'Facture',
      text: 'x',
      at: now - DAY,
    })
    held.push(m.threadId)
    const res = await createHandler(h.deps)(
      post({
        action: 'open',
        connection_id: CONNECTION_ID,
        gmail_thread_id: m.threadId,
      }),
    )
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { thread_id: `mirror-${m.threadId}` })
    assertEquals(gmailCalls(), [])
    assertEquals(h.state.upserted, [])
  }))

Deno.test('gmail-search: a thread Gmail does not have, or with nothing in the 24 months, is not found', () =>
  run(async () => {
    const { h } = setup()
    const old = h.google.deliver({
      from: 'a@exemple.test',
      subject: 'Vieux',
      text: 'x',
      at: now - 800 * DAY,
    })
    const handler = createHandler(h.deps)
    assertEquals(
      (await handler(
        post({
          action: 'open',
          connection_id: CONNECTION_ID,
          gmail_thread_id: 'tunknown',
        }),
      )).status,
      404,
    )
    assertEquals(
      (await handler(
        post({
          action: 'open',
          connection_id: CONNECTION_ID,
          gmail_thread_id: old.threadId,
        }),
      )).status,
      404,
    )
    assertEquals(h.state.upserted, [])
  }))

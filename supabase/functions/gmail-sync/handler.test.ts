import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  CONNECTION_ID,
  gmailHarness,
  ORG_ID,
} from '../_shared/testing/gmail-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/gmail-sync'
const SECRET = 'local-dev-internal-function-secret'
const JOB = 'communications.gmail_sync'
const NOW_S = Math.floor(Date.parse('2026-10-12T15:00:00.000Z') / 1000)

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0'))
    .join('')

/** A request signed as `private.invoke_job_function` signs it. */
async function jobRequest(
  body: { job_key: string; org_id: string | null; trigger: string },
): Promise<Request> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const message = `${NOW_S}.${body.job_key}.${
    body.org_id ?? ''
  }.${body.trigger}`
  const mac = hex(
    await crypto.subtle.sign('HMAC', key, encoder.encode(message)),
  )
  return new Request(URL_, {
    method: 'POST',
    headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
    body: JSON.stringify(body),
  })
}

const post = (body: unknown, token: string | null = 'tok') =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

/** The env the shared helpers read themselves (`consume` hashes with the secret; CORS echoes the origin). */
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  }, fn)
Deno.test('gmail-sync job: every connected mailbox of the org is synced and the run detail counts', () =>
  run(async () => {
    const h = gmailHarness()
    h.google.deliver({ from: 'a@example.test', subject: 'A', text: 'a' })
    h.google.deliver({ from: 'b@example.test', subject: 'B', text: 'b' })
    const res = await createHandler(h.deps)(
      await jobRequest({ job_key: JOB, org_id: null, trigger: 'cron' }),
    )
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { runs: 1 })
    const finish = h.service.calls.find((c) => c.fn === 'finish_job_run')!
    assertEquals(finish.args.p_status, 'ok')
    assertEquals(finish.args.p_detail, '1 boîte : 2 messages, 0 pièce jointe')
    assertEquals(h.state.upserted.length, 2)
  }))

Deno.test('gmail-sync job: no connected mailbox → an ok run saying so; a provider failure → an error run with its code', () =>
  run(async () => {
    const none = gmailHarness({
      rpc: { list_mail_connections_to_sync: { data: [] } },
    })
    await createHandler(none.deps)(
      await jobRequest({ job_key: JOB, org_id: ORG_ID, trigger: 'manual' }),
    )
    assertEquals(
      none.service.calls.find((c) => c.fn === 'finish_job_run')!.args.p_detail,
      'Aucune boîte connectée',
    )

    const down = gmailHarness()
    down.deps.fetch = (() =>
      Promise.reject(new TypeError('refused'))) as unknown as typeof fetch
    await captureConsole('error', async () => {
      await createHandler(down.deps)(
        await jobRequest({ job_key: JOB, org_id: ORG_ID, trigger: 'manual' }),
      )
    })
    const finish = down.service.calls.find((c) =>
      c.fn === 'finish_job_run'
    )!
    assertEquals([finish.args.p_status, finish.args.p_detail], [
      'error',
      'gmail_unreachable',
    ])
  }))

Deno.test('gmail-sync job: an unsigned or wrongly signed request is refused', () =>
  run(async () => {
    const h = gmailHarness()
    const handler = createHandler(h.deps)
    const req = await jobRequest({
      job_key: JOB,
      org_id: null,
      trigger: 'cron',
    })
    req.headers.set('X-Job-Signature', `t=${NOW_S},v1=${'0'.repeat(64)}`)
    assertEquals((await handler(req)).status, 401)
    assertEquals(
      (await handler(
        await jobRequest({
          job_key: 'core.storage_cleanup',
          org_id: null,
          trigger: 'cron',
        }),
      )).status,
      400,
    )
  }))

Deno.test('gmail-sync user: « Synchroniser » needs the permission, finds the mailbox and answers the outcome; `full` forgets the history', () =>
  run(async () => {
    const h = gmailHarness()
    h.google.deliver({ from: 'a@example.test', subject: 'A', text: 'a' })
    const handler = createHandler(h.deps)
    assertEquals(
      (await handler(post({ connection_id: CONNECTION_ID }, null))).status,
      401,
    )
    const denied = createHandler(
      gmailHarness({ permissions: ['communications.inbox'] }).deps,
    )
    assertEquals(
      (await denied(post({ connection_id: CONNECTION_ID }))).status,
      403,
    )
    assertEquals(
      (await handler(
        post({ connection_id: '00000000-0000-4000-8000-00000000dead' }),
      )).status,
      404,
    )

    let res = await handler(post({ connection_id: CONNECTION_ID }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), {
      outcome: 'synced',
      messages: 1,
      attachments: 0,
      initial_pending: false,
    })
    assert(h.state.sync.initial_sync_done)

    res = await handler(post({ connection_id: CONNECTION_ID, full: true }))
    assertEquals((await res.json()).messages, 1, 'the 45-day pass ran again')
    assert(h.rpcNames().includes('reset_mail_history'))
    assertEquals(
      h.service.calls.filter((c) => c.fn === 'consume_rate_limit').map((c) =>
        c.args.p_bucket
      ),
      ['gmail.sync_user', 'gmail.sync_user', 'gmail.sync_user'],
      'one hit per call, the unknown mailbox included (the limit comes first)',
    )
  }))

Deno.test('gmail-sync user: a mailbox that needs reconnection answers the outcome, 200', () =>
  run(async () => {
    const h = gmailHarness()
    h.google.grants.get(h.state.connection!.refresh)!.revoked = true
    h.state.connection!.expiresAt = '2026-10-12T15:01:00.000Z'
    const res = await createHandler(h.deps)(
      post({ connection_id: CONNECTION_ID }),
    )
    assertEquals(res.status, 200)
    assertEquals((await res.json()).outcome, 'needs_reconnect')
  }))

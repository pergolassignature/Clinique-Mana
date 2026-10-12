import { assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import {
  gmailHarness,
  initialState,
  ORG_ID,
  TOPIC,
} from '../_shared/testing/gmail-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/gmail-watch-renew'
const SECRET = 'local-dev-internal-function-secret'
const JOB = 'communications.gmail_watch_renew'
const NOW_S = Math.floor(Date.parse('2026-10-12T15:00:00.000Z') / 1000)
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0'))
    .join('')

async function jobRequest(): Promise<Request> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = hex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${NOW_S}.${JOB}.${ORG_ID}.manual`),
    ),
  )
  return new Request(URL_, {
    method: 'POST',
    headers: { 'X-Job-Signature': `t=${NOW_S},v1=${mac}` },
    body: JSON.stringify({ job_key: JOB, org_id: ORG_ID, trigger: 'manual' }),
  })
}

Deno.test('gmail-watch-renew: a missing or near-expiry watch is renewed with the topic; a far one is left', async () => {
  const h = gmailHarness()
  await createHandler(h.deps)(await jobRequest())
  assertEquals(
    h.service.calls.find((c) => c.fn === 'finish_job_run')!.args.p_detail,
    '1 boîte : 1 renouvelée',
  )
  assertEquals(h.google.watch?.topicName, TOPIC)
  const far = gmailHarness()
  far.state.sync.watch_expires_at = '2026-10-18T15:00:00.000Z'
  await createHandler(far.deps)(await jobRequest())
  assertEquals(
    far.service.calls.find((c) => c.fn === 'finish_job_run')!.args.p_detail,
    '1 boîte : 0 renouvelée',
  )
  assertEquals(far.google.watch, null)
})

Deno.test('gmail-watch-renew: no topic → nothing done, said in the detail; a revoked grant counts as to reconnect', async () => {
  const none = gmailHarness({
    state: initialState({
      settings: { pubsub_topic: null, pubsub_service_account: null },
    }),
  })
  await createHandler(none.deps)(await jobRequest())
  assertEquals(
    none.service.calls.find((c) => c.fn === 'finish_job_run')!.args.p_detail,
    'Aucun sujet Pub/Sub configuré',
  )
  assertEquals(none.google.calls.length, 0)

  const revoked = gmailHarness()
  revoked.google.grants.get(revoked.state.connection!.refresh)!.revoked = true
  revoked.state.connection!.expiresAt = '2026-10-12T15:01:00.000Z'
  await createHandler(revoked.deps)(await jobRequest())
  const finish = revoked.service.calls.find((c) => c.fn === 'finish_job_run')!
  assertEquals([finish.args.p_status, finish.args.p_detail], [
    'ok',
    '1 boîte : 0 renouvelée, 1 à reconnecter',
  ])
  assertEquals(revoked.state.connection!.status, 'needs_reconnect')
})

import { assertEquals, assertRejects } from '@std/assert'
import { FunctionError } from './http.ts'
import {
  claimEvent,
  type ClaimInput,
  completeEvent,
  failEvent,
  webhookResponse,
} from './webhooks.ts'
import { fakeSupabase } from './testing/fake-supabase.ts'

const INPUT: ClaimInput = {
  provider: 'resend',
  eventId: 'msg_1',
  orgId: 'o1',
  eventType: 'email.delivered',
  payload: { type: 'email.delivered', email_log_id: 'e1' },
}

const claimWith = (data: unknown) =>
  fakeSupabase({ rpc: { claim_webhook_event: { data } } })

// ---------------------------------------------------------------------------
// webhookResponse
// ---------------------------------------------------------------------------
Deno.test('webhookResponse: JSON, no-store, and no CORS header', async () => {
  const res = webhookResponse(409, { status: 'in_progress' })
  assertEquals(res.status, 409)
  assertEquals(res.headers.get('Cache-Control'), 'no-store')
  assertEquals(res.headers.get('Content-Type'), 'application/json')
  assertEquals(await res.json(), { status: 'in_progress' })
  const cors = [...res.headers.keys()].filter((k) =>
    k.startsWith('access-control-')
  )
  assertEquals(cors, [])
})

Deno.test('webhookResponse: no body, no content type', async () => {
  const res = webhookResponse(200)
  assertEquals(res.headers.get('Content-Type'), null)
  assertEquals(res.headers.get('Cache-Control'), 'no-store')
  assertEquals(await res.text(), '')
})

// ---------------------------------------------------------------------------
// claimEvent
// ---------------------------------------------------------------------------
Deno.test('claimEvent: passes the RPC arguments and maps claimed', async () => {
  const { client, calls } = claimWith([
    { status: 'claimed', id: 'w1', claim_token: 't1' },
  ])
  assertEquals(await claimEvent(client, INPUT), {
    status: 'claimed',
    id: 'w1',
    token: 't1',
  })
  assertEquals(calls, [{
    fn: 'claim_webhook_event',
    args: {
      p_provider: 'resend',
      p_event_id: 'msg_1',
      p_org_id: 'o1',
      p_event_type: 'email.delivered',
      p_payload: { type: 'email.delivered', email_log_id: 'e1' },
    },
  }])
})

Deno.test('claimEvent: maps duplicate and in_progress (no token)', async () => {
  for (const status of ['duplicate', 'in_progress'] as const) {
    const { client } = claimWith([{ status, id: 'w1', claim_token: null }])
    assertEquals(await claimEvent(client, INPUT), { status })
  }
})

Deno.test('claimEvent: an RPC error or an unexpected row throws FunctionError internal', async () => {
  const failing = [
    fakeSupabase({
      rpc: {
        claim_webhook_event: {
          error: {
            code: '22023',
            message: 'Webhook event belongs to another org',
          },
        },
      },
    }).client,
    claimWith([]).client,
    claimWith([{ status: 'claimed', id: 'w1', claim_token: null }]).client,
    claimWith([{ status: 'weird' }]).client,
  ]
  for (const client of failing) {
    const error = await assertRejects(
      () => claimEvent(client, INPUT),
      FunctionError,
    )
    assertEquals(error.code, 'internal')
    assertEquals(error.message.includes('another org'), false)
  }
})

// ---------------------------------------------------------------------------
// completeEvent / failEvent
// ---------------------------------------------------------------------------
Deno.test('completeEvent: passes id and token, returns the RPC boolean', async () => {
  const { client, calls } = fakeSupabase({
    rpc: { complete_webhook_event: { data: false } },
  })
  assertEquals(await completeEvent(client, 'w1', 't1'), false)
  assertEquals(calls, [{
    fn: 'complete_webhook_event',
    args: { p_id: 'w1', p_claim_token: 't1' },
  }])
})

Deno.test('failEvent: passes id, token and code, returns the RPC boolean', async () => {
  const { client, calls } = fakeSupabase({
    rpc: { fail_webhook_event: { data: true } },
  })
  assertEquals(
    await failEvent(client, 'w1', 't1', 'documenso_download_failed'),
    true,
  )
  assertEquals(calls, [{
    fn: 'fail_webhook_event',
    args: {
      p_id: 'w1',
      p_claim_token: 't1',
      p_error: 'documenso_download_failed',
    },
  }])
})

Deno.test('completeEvent / failEvent: an RPC error or a non-boolean throws', async () => {
  const { client } = fakeSupabase({
    rpc: {
      complete_webhook_event: { error: { code: 'XX000', message: 'boom' } },
      fail_webhook_event: { data: null },
    },
  })
  await assertRejects(() => completeEvent(client, 'w1', 't1'), FunctionError)
  await assertRejects(
    () => failEvent(client, 'w1', 't1', 'internal'),
    FunctionError,
  )
})

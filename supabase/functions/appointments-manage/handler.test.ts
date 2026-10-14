import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { fakeFetch } from '../_shared/testing/fake-fetch.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { withEnv } from '../_shared/testing/env.ts'

const URL_ = 'http://fn.test/functions/v1/appointments-manage'
const APP = 'http://localhost:5173'
const ALLOWED = { allowed: true, hits: 1, retry_after_seconds: 0 }
const REFUSED = { allowed: false, hits: 21, retry_after_seconds: 600 }
const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'

function setup(options: { manage?: RpcRoute; limited?: boolean } = {}) {
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: { data: [options.limited ? REFUSED : ALLOWED] },
      manage_appointment_by_link_for_service: options.manage ??
        { data: { state: 'cancelled', late: false } },
    },
  })
  const http = fakeFetch({})
  const deps: Deps = {
    env: () => undefined,
    fetch: http.fetch,
    now: fixedClock('2026-10-16T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => {
      throw new Error('no user on the public page')
    },
  }
  return { handler: createHandler(deps), service }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
  }, fn)
const post = (b: unknown) =>
  new Request(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP },
    body: JSON.stringify(b),
  })
const manageCalls = (s: ReturnType<typeof setup>) =>
  s.service.calls.filter((c) =>
    c.fn === 'manage_appointment_by_link_for_service'
  )

Deno.test('appointments-manage: the IP limit comes before any lookup', async () => {
  await run(async () => {
    const s = setup({ limited: true })
    assertEquals(
      (await s.handler(post({ token: TOKEN, action: 'cancel' }))).status,
      429,
    )
    assertEquals(manageCalls(s).length, 0)
  })
})

Deno.test('appointments-manage: a malformed token is gone before any lookup; the body is checked', async () => {
  await run(async () => {
    const s = setup()
    assertEquals(
      (await s.handler(post({ token: 'court', action: 'cancel' }))).status,
      410,
    )
    assertEquals(
      (await s.handler(post({ token: TOKEN, action: 'move' }))).status,
      400,
    )
    assertEquals((await s.handler(post({ token: TOKEN }))).status, 400)
    assertEquals(
      (await s.handler(post({ token: TOKEN, action: 'cancel', extra: 1 })))
        .status,
      400,
    )
    assertEquals(manageCalls(s).length, 0)
  })
})

Deno.test('appointments-manage: the token’s hash and the action go to the database, never the token; cancelled', async () => {
  await run(async () => {
    const s = setup({ manage: { data: { state: 'cancelled', late: true } } })
    const res = await s.handler(post({ token: TOKEN, action: 'cancel' }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { state: 'cancelled', late: true })
    assertEquals(res.headers.get('Cache-Control'), 'no-store')
    const [call] = manageCalls(s)
    assert(String(call.args.p_token_hash).startsWith('\\x'))
    assertEquals(call.args.p_action, 'cancel')
    assert(!JSON.stringify(call.args).includes(TOKEN))
  })
})

Deno.test('appointments-manage: a change request answers requested', async () => {
  await run(async () => {
    const s = setup({ manage: { data: { state: 'requested', late: false } } })
    const res = await s.handler(
      post({ token: TOKEN, action: 'change_request' }),
    )
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { state: 'requested' })
    assertEquals(manageCalls(s)[0].args.p_action, 'change_request')
  })
})

Deno.test('appointments-manage: a used, revoked or switched-off link answers link_invalid', async () => {
  await run(async () => {
    const s = setup({ manage: { data: { state: 'invalid' } } })
    const res = await s.handler(post({ token: TOKEN, action: 'cancel' }))
    assertEquals(res.status, 410)
    assertEquals((await res.json()).error.code, 'link_invalid')
  })
})

Deno.test('appointments-manage: an unexpected answer is an internal error', async () => {
  await run(async () => {
    const s = setup({ manage: { data: { state: 'done' } } })
    const res = await s.handler(post({ token: TOKEN, action: 'cancel' }))
    assertEquals(res.status, 500)
  })
})

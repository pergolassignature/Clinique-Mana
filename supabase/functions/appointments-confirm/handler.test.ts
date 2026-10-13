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

const URL_ = 'http://fn.test/functions/v1/appointments-confirm'
const APP = 'http://localhost:5173'
const ALLOWED = { allowed: true, hits: 1, retry_after_seconds: 0 }
const REFUSED = { allowed: false, hits: 21, retry_after_seconds: 600 }
const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'

function setup(options: { confirm?: RpcRoute; limited?: boolean } = {}) {
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: { data: [options.limited ? REFUSED : ALLOWED] },
      confirm_appointment_by_link_for_service: options.confirm ??
        { data: { state: 'confirmed' } },
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
const confirmCalls = (s: ReturnType<typeof setup>) =>
  s.service.calls.filter((c) =>
    c.fn === 'confirm_appointment_by_link_for_service'
  )

Deno.test('appointments-confirm: the IP limit comes before any lookup', async () => {
  await run(async () => {
    const s = setup({ limited: true })
    assertEquals((await s.handler(post({ token: TOKEN }))).status, 429)
    assertEquals(confirmCalls(s).length, 0)
  })
})

Deno.test('appointments-confirm: a malformed token is gone before any lookup; the body is checked', async () => {
  await run(async () => {
    const s = setup()
    assertEquals((await s.handler(post({ token: 'court' }))).status, 410)
    assertEquals(
      (await s.handler(post({ token: TOKEN, extra: true }))).status,
      400,
    )
    assertEquals(confirmCalls(s).length, 0)
  })
})

Deno.test('appointments-confirm: the token’s hash goes to the database, never the token; confirmed', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(post({ token: TOKEN }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { state: 'confirmed' })
    assertEquals(res.headers.get('Cache-Control'), 'no-store')
    const [call] = confirmCalls(s)
    assert(String(call.args.p_token_hash).startsWith('\\x'))
    assert(!JSON.stringify(call.args).includes(TOKEN))
  })
})

Deno.test('appointments-confirm: a used, expired or cancelled link answers link_invalid', async () => {
  await run(async () => {
    const s = setup({ confirm: { data: { state: 'invalid' } } })
    const res = await s.handler(post({ token: TOKEN }))
    assertEquals(res.status, 410)
    assertEquals((await res.json()).error.code, 'link_invalid')
  })
})

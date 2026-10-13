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

const URL_ = 'http://fn.test/functions/v1/demandes-waitlist-answer'
const APP = 'http://localhost:5173'
const ALLOWED = { allowed: true, hits: 1, retry_after_seconds: 0 }
const REFUSED = { allowed: false, hits: 21, retry_after_seconds: 600 }
const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'

function setup(
  options: { answer?: RpcRoute; limited?: boolean } = {},
) {
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: {
        data: [options.limited ? REFUSED : ALLOWED],
      },
      answer_waitlist_followup_for_service: options.answer ??
        ((args) => ({ data: { state: String(args.p_answer) } })),
    },
  })
  const http = fakeFetch({})
  const deps: Deps = {
    env: () => undefined,
    fetch: http.fetch,
    now: fixedClock('2026-10-13T15:00:00Z').now,
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
const answerCalls = (s: ReturnType<typeof setup>) =>
  s.service.calls.filter((c) => c.fn === 'answer_waitlist_followup_for_service')

Deno.test('demandes-waitlist-answer: the IP limit comes before any lookup', async () => {
  await run(async () => {
    const s = setup({ limited: true })
    const res = await s.handler(post({ token: TOKEN, answer: 'stay' }))
    assertEquals(res.status, 429)
    assertEquals(answerCalls(s).length, 0)
  })
})

Deno.test('demandes-waitlist-answer: a malformed token is gone before any lookup; the body is checked', async () => {
  await run(async () => {
    const s = setup()
    assertEquals(
      (await s.handler(post({ token: 'court', answer: 'stay' }))).status,
      410,
    )
    assertEquals(
      (await s.handler(post({ token: TOKEN, answer: 'maybe' }))).status,
      400,
    )
    assertEquals(answerCalls(s).length, 0)
  })
})

Deno.test('demandes-waitlist-answer: « Oui » and « Non » go to the database with the token’s hash, never the token', async () => {
  await run(async () => {
    for (const answer of ['stay', 'leave'] as const) {
      const s = setup()
      const res = await s.handler(post({ token: TOKEN, answer }))
      assertEquals(res.status, 200)
      assertEquals(await res.json(), { state: answer })
      assertEquals(res.headers.get('Cache-Control'), 'no-store')
      const [call] = answerCalls(s)
      assertEquals(call.args.p_answer, answer)
      assert(String(call.args.p_token_hash).startsWith('\\x'))
      assert(!JSON.stringify(call.args).includes(TOKEN))
    }
  })
})

Deno.test('demandes-waitlist-answer: a used, expired or closed link answers link_invalid', async () => {
  await run(async () => {
    const s = setup({ answer: { data: { state: 'invalid' } } })
    const res = await s.handler(post({ token: TOKEN, answer: 'leave' }))
    assertEquals(res.status, 410)
    assertEquals((await res.json()).error.code, 'link_invalid')
  })
})

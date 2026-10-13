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

const URL_ = 'http://fn.test/functions/v1/demandes-proposition-answer'
const APP = 'http://localhost:5173'
const ALLOWED = { allowed: true, hits: 1, retry_after_seconds: 0 }
const REFUSED = { allowed: false, hits: 21, retry_after_seconds: 600 }
const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const SLOT = '00000000-0000-4000-8000-0000000000a1'

function setup(options: { answer?: RpcRoute; limited?: boolean } = {}) {
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: { data: [options.limited ? REFUSED : ALLOWED] },
      answer_proposition_for_service: options.answer ??
        ((args) => ({
          data: args.p_appointment_id
            ? { state: 'accepted', starts_at: '2027-03-15T13:00:00Z' }
            : { state: 'declined' },
        })),
    },
  })
  const deps: Deps = {
    env: () => undefined,
    fetch: fakeFetch({}).fetch,
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
const answers = (s: ReturnType<typeof setup>) =>
  s.service.calls.filter((c) => c.fn === 'answer_proposition_for_service')

Deno.test('demandes-proposition-answer: the IP limit first; a malformed token is gone before any lookup', async () => {
  await run(async () => {
    const limited = setup({ limited: true })
    assertEquals(
      (await limited.handler(post({ token: TOKEN, appointment_id: SLOT })))
        .status,
      429,
    )
    assertEquals(answers(limited).length, 0)
    const s = setup()
    assertEquals(
      (await s.handler(post({ token: 'court', appointment_id: SLOT }))).status,
      410,
    )
    assertEquals(
      (await s.handler(post({ token: TOKEN, decline: false }))).status,
      400,
    )
    assertEquals(answers(s).length, 0)
  })
})

Deno.test('demandes-proposition-answer: a slot accepted, with the token’s hash only', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(post({ token: TOKEN, appointment_id: SLOT }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), {
      state: 'accepted',
      starts_at: '2027-03-15T13:00:00Z',
    })
    assertEquals(res.headers.get('Cache-Control'), 'no-store')
    const [call] = answers(s)
    assertEquals(call.args.p_appointment_id, SLOT)
    assertEquals(call.args.p_decline_reason, null)
    assert(String(call.args.p_token_hash).startsWith('\\x'))
    assert(!JSON.stringify(call.args).includes(TOKEN))
  })
})

Deno.test('demandes-proposition-answer: « Aucune ne me convient » with a reason', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(
      post({ token: TOKEN, decline: true, reason: 'schedule' }),
    )
    assertEquals(await res.json(), { state: 'declined' })
    assertEquals(answers(s)[0].args.p_appointment_id, null)
    assertEquals(answers(s)[0].args.p_decline_reason, 'schedule')
  })
})

Deno.test('demandes-proposition-answer: a slot no longer possible passes R1b’s HINT on; a spent link is 410', async () => {
  await run(async () => {
    const unavailable = setup({
      answer: { data: { state: 'unavailable', reason: 'overlap' } },
    })
    const res = await unavailable.handler(
      post({ token: TOKEN, appointment_id: SLOT }),
    )
    assertEquals(await res.json(), { state: 'unavailable', reason: 'overlap' })
    const gone = setup({ answer: { data: { state: 'invalid' } } })
    const res2 = await gone.handler(
      post({ token: TOKEN, appointment_id: SLOT }),
    )
    assertEquals(res2.status, 410)
    assertEquals((await res2.json()).error.code, 'link_invalid')
  })
})

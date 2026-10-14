import { assert, assertEquals } from '@std/assert'
import { createHandler } from './handler.ts'
import { signState } from '../_shared/oauth-state.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import { FAKE_CALENDAR_CLIENT_ID } from '../_shared/testing/fake-gmail.ts'
import {
  ACCOUNT,
  ADMIN_ID,
  CALENDAR_APP_SECRETS,
  calendarHarness,
  FREEBUSY,
  ORG_ID,
  SECRET,
} from '../_shared/testing/google-calendar-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/google-calendar-callback'
const post = (body: unknown) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      Authorization: 'Bearer tok',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: SECRET,
    ALLOWED_ORIGINS: 'http://localhost:5173',
  }, fn)
const SCOPES = `openid email ${FREEBUSY}`

async function signed(
  h: ReturnType<typeof calendarHarness>,
  over: { orgId?: string; userId?: string; purpose?: string } = {},
) {
  return (await signState(SECRET, {
    purpose: over.purpose ?? 'google_calendar_connect',
    orgId: over.orgId ?? ORG_ID,
    userId: over.userId ?? ADMIN_ID,
  }, h.deps.now())).state
}

Deno.test('google-calendar-callback: the happy path stores the connection, syncs at once and answers the address and the count only', () =>
  run(async () => {
    const h = calendarHarness()
    h.google.busy.push(
      { start: '2026-10-14T14:00:00Z', end: '2026-10-14T15:30:00Z' },
      { start: '2026-10-15T18:00:00Z', end: '2026-10-15T19:00:00Z' },
      // Outside the 62 days read: not stored.
      { start: '2027-01-20T14:00:00Z', end: '2027-01-20T15:00:00Z' },
    )
    const code = h.google.issueCode(SCOPES)
    const res = await createHandler(h.deps)(
      post({ code, state: await signed(h) }),
    )
    assertEquals(res.status, 200)
    const text = await res.text()
    assertEquals(JSON.parse(text), { email: ACCOUNT, busy: 2 })
    assert(!text.includes('ya29.'))
    assert(!text.includes('1//'))
    const store = h.service.calls.find((c) =>
      c.fn === 'store_calendar_connection'
    )!
    assertEquals(store.args.p_actor, ADMIN_ID)
    assertEquals(store.args.p_org_id, ORG_ID)
    assertEquals(store.args.p_external_user_id, '100000000000000000001')
    assertEquals(store.args.p_account_email, ACCOUNT)
    assertEquals(store.args.p_scopes, ['openid', 'email', FREEBUSY])
    assert(String(store.args.p_refresh_token).startsWith('1//fake-refresh-'))
    // The busy times: start and end only, for her primary calendar.
    assertEquals(h.state.replaced.length, 1)
    assertEquals(h.state.replaced[0].blocks, [
      { start: '2026-10-14T14:00:00Z', end: '2026-10-14T15:30:00Z' },
      { start: '2026-10-15T18:00:00Z', end: '2026-10-15T19:00:00Z' },
    ])
    assertEquals(h.google.freeBusyCalls[0].ids, ['primary'])
    assertEquals(h.google.freeBusyCalls[0].timeMin, '2026-10-13T15:00:00.000Z')
    assertEquals(h.google.freeBusyCalls[0].timeMax, '2026-12-14T15:00:00.000Z')
    const limits = h.service.calls.filter((c) => c.fn === 'consume_rate_limit')
      .map((c) => c.args.p_bucket)
    assertEquals(limits, ['google_calendar.callback_user'])
    const spend = h.service.calls.filter((c) =>
      c.fn === 'spend_oauth_state_nonce_for_service'
    )
    assertEquals(spend.length, 1)
    assert(/^\\x[0-9a-f]{64}$/.test(String(spend[0].args.p_nonce_hash)))
  }))

Deno.test('google-calendar-callback: the free/busy box unticked → a French refusal, the grant revoked, nothing stored', () =>
  run(async () => {
    const h = calendarHarness()
    const code = h.google.issueCode('openid email')
    const res = await createHandler(h.deps)(
      post({ code, state: await signed(h) }),
    )
    assertEquals(res.status, 400)
    const body = await res.json()
    assertEquals(body.error.refusal, true)
    assert(body.error.message.includes('disponibilités'))
    assert([...h.google.grants.values()].every((g) => g.revoked))
    assert(!h.rpcNames().includes('store_calendar_connection'))
  }))

Deno.test('google-calendar-callback: a state for another person → 403, the code never exchanged', () =>
  run(async () => {
    const h = calendarHarness()
    const code = h.google.issueCode(SCOPES)
    const res = await createHandler(h.deps)(
      post({
        code,
        state: await signed(h, {
          userId: '00000000-0000-4000-8000-0000000000ff',
        }),
      }),
    )
    assertEquals(res.status, 403)
    assertEquals(h.google.calls.length, 0)
  }))

Deno.test('google-calendar-callback: Gmail’s state (another purpose) or a forged one → 410 link_invalid', () =>
  run(async () => {
    const h = calendarHarness()
    const handler = createHandler(h.deps)
    const code = h.google.issueCode(SCOPES)
    const other = await handler(
      post({ code, state: await signed(h, { purpose: 'gmail_connect' }) }),
    )
    assertEquals(other.status, 410)
    assertEquals((await other.json()).error.code, 'link_invalid')
    const forged = await handler(post({ code, state: 'abc.def' }))
    assertEquals(forged.status, 410)
    assertEquals(h.google.calls.length, 0)
  }))

Deno.test('google-calendar-callback: an expired state → 410 link_expired', () =>
  run(async () => {
    const h = calendarHarness()
    const state = await signed(h)
    h.advance(11 * 60_000)
    const res = await createHandler(h.deps)(
      post({ code: h.google.issueCode(SCOPES), state }),
    )
    assertEquals(res.status, 410)
    assertEquals((await res.json()).error.code, 'link_expired')
  }))

Deno.test('google-calendar-callback: a replayed state → 410 link_used, even minutes later; the check unavailable → 503', () =>
  run(async () => {
    const h = calendarHarness()
    const handler = createHandler(h.deps)
    const state = await signed(h)
    const first = await handler(
      post({ code: h.google.issueCode(SCOPES), state }),
    )
    assertEquals(first.status, 200)
    const googleCalls = h.google.calls.length
    for (const minutes of [0, 9]) {
      h.advance(minutes * 60_000)
      const res = await handler(
        post({ code: h.google.issueCode(SCOPES), state }),
      )
      assertEquals(res.status, 410)
      assertEquals((await res.json()).error.code, 'link_used')
    }
    assertEquals(h.google.calls.length, googleCalls)

    const down = calendarHarness({
      rpc: {
        spend_oauth_state_nonce_for_service: {
          error: { code: '22023', message: 'Arguments invalides.' },
        },
      },
    })
    let res: Response | undefined
    await captureConsole('error', async () => {
      res = await createHandler(down.deps)(
        post({
          code: down.google.issueCode(SCOPES),
          state: await signed(down),
        }),
      )
    })
    assertEquals(res!.status, 503)
    assertEquals((await res!.json()).error.code, 'not_configured')
    assertEquals(down.google.calls.length, 0)
  }))

Deno.test('google-calendar-callback: a code Google refuses → a French refusal, Google’s body never passed on', () =>
  run(async () => {
    const h = calendarHarness()
    const res = await createHandler(h.deps)(
      post({ code: '4/unknown', state: await signed(h) }),
    )
    assertEquals(res.status, 400)
    const text = await res.text()
    assert(JSON.parse(text).error.refusal)
    assert(!text.includes('FAKE-GOOGLE-ERROR-BODY'))
  }))

Deno.test('google-calendar-callback: the account already connected for another professional → the French refusal of the RPC', () =>
  run(async () => {
    const h = calendarHarness({
      rpc: {
        store_calendar_connection: {
          error: {
            code: 'P0001',
            message:
              'Cet agenda Google est déjà connecté pour un autre professionnel.',
          },
        },
      },
    })
    const res = await createHandler(h.deps)(
      post({ code: h.google.issueCode(SCOPES), state: await signed(h) }),
    )
    assertEquals(res.status, 400)
    const body = await res.json()
    assertEquals(body.error.refusal, true)
    assertEquals(h.state.replaced.length, 0)
  }))

Deno.test('google-calendar-callback: a failed first sync still answers 200 (the job catches up), with busy null', () =>
  run(async () => {
    const h = calendarHarness()
    const base = h.deps.fetch
    h.deps.fetch = (input, init) => {
      const url = new Request(input, init).url
      return url.includes('/calendar/v3/')
        ? Promise.resolve(new Response('{}', { status: 503 }))
        : base(input, init)
    }
    const res = await createHandler(h.deps)(
      post({ code: h.google.issueCode(SCOPES), state: await signed(h) }),
    )
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { email: ACCOUNT, busy: null })
    assertEquals(h.state.errors, ['provider_error'])
  }))

Deno.test('google-calendar-callback: nothing it reports carries a token or an address', () =>
  run(async () => {
    const h = calendarHarness({
      rpc: { store_calendar_connection: { error: { code: 'XX000' } } },
    })
    const logs = await captureConsole('error', async () => {
      const res = await createHandler(h.deps)(
        post({ code: h.google.issueCode(SCOPES), state: await signed(h) }),
      )
      assertEquals(res.status, 500)
    })
    const all = JSON.stringify(logs)
    assert(!all.includes('ya29.'))
    assert(!all.includes(ACCOUNT))
    assertEquals(h.state.connection, null)
  }))

Deno.test('google-calendar-callback: the code is exchanged with the calendars’ own application when it is set (AP-46)', () =>
  run(async () => {
    const h = calendarHarness({
      state: {
        secrets: {
          google_oauth_client_id: 'gmail-client',
          google_oauth_client_secret: 'gmail-secret',
          ...CALENDAR_APP_SECRETS,
        },
      },
    })
    const code = h.google.issueCode(SCOPES, FAKE_CALENDAR_CLIENT_ID)
    const res = await createHandler(h.deps)(
      post({ code, state: await signed(h) }),
    )
    assertEquals(res.status, 200)
    const refresh = h.state.connection!.refresh
    assertEquals(
      h.google.grants.get(refresh)?.clientId,
      FAKE_CALENDAR_CLIENT_ID,
    )
  }))

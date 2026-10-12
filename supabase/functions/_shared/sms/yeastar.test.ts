import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  findSmsChannel,
  getSession,
  refreshTokens,
  requestTokens,
  sendText,
  type YeastarCall,
  YeastarError,
} from './yeastar.ts'
import {
  FAKE_YEASTAR_CLIENT_ID,
  FAKE_YEASTAR_CLIENT_SECRET,
  FAKE_YEASTAR_DID,
  fakeYeastar,
  type FakeYeastarOptions,
} from '../testing/fake-yeastar.ts'
import { fixedClock } from '../testing/fixed-clock.ts'

const BASE = 'http://pbx.test'
const NOW = '2027-03-10T15:00:00Z'
const CREDENTIALS = {
  clientId: FAKE_YEASTAR_CLIENT_ID,
  clientSecret: FAKE_YEASTAR_CLIENT_SECRET,
}

function setup(options: FakeYeastarOptions = {}) {
  const clock = fixedClock(NOW)
  const fake = fakeYeastar({ now: clock.now, ...options })
  const calls: string[] = []
  const ctx: YeastarCall = {
    baseUrl: BASE,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      calls.push(`${req.method} ${new URL(req.url).pathname}`)
      return fake.handler(req)
    }) as typeof fetch,
    now: clock.now,
  }
  return { fake, ctx, calls, clock }
}

Deno.test('requestTokens: a session from the credentials, with the PBX expiries', async () => {
  const { ctx, fake } = setup()
  const tokens = await requestTokens(ctx, CREDENTIALS)
  assertEquals(tokens.accessToken, 'fake-access-1')
  assertEquals(tokens.refreshToken, 'fake-refresh-1')
  assertEquals(tokens.accessExpiresAt.toISOString(), '2027-03-10T15:30:00.000Z')
  assertEquals(
    tokens.refreshExpiresAt?.toISOString(),
    '2027-03-11T15:00:00.000Z',
  )
  assertEquals(fake.tokenCalls, ['get_token'])
})

Deno.test('requestTokens: wrong credentials are provider_rejected, the token cap is token_limit', async () => {
  const wrong = await assertRejects(
    () => requestTokens(setup().ctx, { clientId: 'x', clientSecret: 'y' }),
    YeastarError,
  )
  assertEquals(wrong.code, 'provider_rejected')
  assertEquals(wrong.errcode, 10001)
  const limit = await assertRejects(
    () => requestTokens(setup({ tokenLimit: true }).ctx, CREDENTIALS),
    YeastarError,
  )
  assertEquals(limit.code, 'token_limit')
})

Deno.test('refreshTokens renews from the refresh token; a stale one is refused', async () => {
  const { ctx } = setup()
  const first = await requestTokens(ctx, CREDENTIALS)
  const second = await refreshTokens(ctx, first.refreshToken!)
  assertEquals(second.accessToken, 'fake-access-2')
  const stale = await assertRejects(
    () => refreshTokens(ctx, first.refreshToken!),
    YeastarError,
  )
  assertEquals(stale.code, 'provider_rejected')
})

Deno.test('findSmsChannel finds the SMS channel of the clinic number by its last digits', async () => {
  const { ctx } = setup()
  const { accessToken } = await requestTokens(ctx, CREDENTIALS)
  assertEquals(
    await findSmsChannel(ctx, accessToken, '(418) 555-0199'),
    'general',
  )
  const none = await assertRejects(
    () => findSmsChannel(ctx, accessToken, '+14185550100'),
    YeastarError,
  )
  assertEquals(
    none.code,
    'channel_not_found',
    'a voice channel is not an SMS channel',
  )
  const invalid = await assertRejects(
    () => findSmsChannel(ctx, 'expired', FAKE_YEASTAR_DID),
    YeastarError,
  )
  assertEquals(invalid.code, 'token_invalid')
})

Deno.test('sendText sends as the API platform and returns the ids; a refused number is provider_rejected', async () => {
  const { ctx, fake } = setup()
  const { accessToken } = await requestTokens(ctx, CREDENTIALS)
  const sent = await sendText(ctx, accessToken, {
    channel: 'general',
    did: FAKE_YEASTAR_DID,
    to: '+15145551234',
    body: 'Bonjour',
    requestId: 'mana-1',
  })
  assertEquals(sent, { msgId: 10000, sessionId: 3000 })
  assertEquals(fake.messages[0].body, 'Bonjour')
  assertEquals(fake.messages[0].requestId, 'mana-1')
  const again = await sendText(ctx, accessToken, {
    channel: 'general',
    did: FAKE_YEASTAR_DID,
    to: '+15145551234',
    body: 'Bonjour',
    requestId: 'mana-1',
  })
  assertEquals(again, sent, 'the same request id is not sent twice')
  const refused = await assertRejects(
    () =>
      sendText(ctx, accessToken, {
        channel: 'general',
        did: FAKE_YEASTAR_DID,
        to: '+15145550000',
        body: 'x',
        requestId: 'mana-2',
      }),
    YeastarError,
  )
  assertEquals(refused.code, 'provider_rejected')
  assertEquals(refused.errcode, 30004)
})

Deno.test('getSession tells the session DID; an unknown session is provider_rejected', async () => {
  const { ctx, fake } = setup()
  const { accessToken } = await requestTokens(ctx, CREDENTIALS)
  await sendText(ctx, accessToken, {
    channel: 'general',
    did: FAKE_YEASTAR_DID,
    to: '+15145551234',
    body: 'x',
    requestId: 'mana-1',
  })
  assertEquals(await getSession(ctx, accessToken, 3000), {
    didNumber: FAKE_YEASTAR_DID,
    channelName: 'general',
    channelType: 'sms',
  })
  fake.foreignSession(4242, '+15145550000')
  assertEquals(
    (await getSession(ctx, accessToken, 4242)).didNumber,
    '+15145550000',
  )
  const unknown = await assertRejects(
    () => getSession(ctx, accessToken, 9),
    YeastarError,
  )
  assertEquals(unknown.code, 'provider_rejected')
})

Deno.test('a network failure is provider_unreachable, a 5xx or a non-JSON body provider_error; nothing of it is in the message', async () => {
  const down: YeastarCall = {
    baseUrl: BASE,
    fetch: (() =>
      Promise.reject(
        new TypeError('connect ECONNREFUSED 10.0.0.1'),
      )) as typeof fetch,
    now: () => new Date(NOW),
  }
  const unreachable = await assertRejects(
    () => requestTokens(down, CREDENTIALS),
    YeastarError,
  )
  assertEquals(unreachable.code, 'provider_unreachable')
  assertEquals(unreachable.message, 'yeastar: provider_unreachable')
  const html: YeastarCall = {
    baseUrl: BASE,
    fetch: (() =>
      Promise.resolve(
        new Response('<html>502</html>', { status: 502 }),
      )) as typeof fetch,
    now: () => new Date(NOW),
  }
  const error = await assertRejects(
    () => requestTokens(html, CREDENTIALS),
    YeastarError,
  )
  assertEquals(error.code, 'provider_error')
  assertEquals(error.status, 502)
  assert(!error.message.includes('502'))
})

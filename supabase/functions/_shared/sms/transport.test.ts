import { assertEquals, assertRejects } from '@std/assert'
import {
  createYeastarTransport,
  SmsTransportError,
  type TransportDeps,
} from './transport.ts'
import { captureConsole, withEnv } from '../testing/env.ts'
import { fakeSupabase, type RpcRoute } from '../testing/fake-supabase.ts'
import {
  FAKE_YEASTAR_CLIENT_ID,
  FAKE_YEASTAR_CLIENT_SECRET,
  FAKE_YEASTAR_DID,
  fakeYeastar,
  type FakeYeastarOptions,
} from '../testing/fake-yeastar.ts'
import { fixedClock } from '../testing/fixed-clock.ts'

const ORG = '00000000-0000-4000-8000-000000000001'
const NOW = '2027-03-10T15:00:00Z'
const BASE = 'https://pbx.test'

/** The stored session, as `get_sms_provider_context` returns it (the tests' database). */
interface Stored {
  base_url: string
  access_token: string
  refresh_token: string | null
  access_expires_at: string
  refresh_expires_at: string | null
}

function setup(
  options: {
    pbx?: FakeYeastarOptions
    session?: Stored | null
    channel?: string | null
    settings?: Partial<
      {
        base_url: string | null
        client_id: string | null
        client_secret: string | null
        did: string | null
      }
    >
    moduleEnabled?: boolean
    env?: Record<string, string | undefined>
    rpc?: Record<string, RpcRoute>
    /** The first lease request is refused, and a token appears meanwhile (another isolate's refresh). */
    otherIsolateRefreshes?: boolean
  } = {},
) {
  const clock = fixedClock(NOW)
  const fake = fakeYeastar({ now: clock.now, ...options.pbx })
  const origins: string[] = []
  const state = {
    session: options.session ?? null,
    channel: options.channel ?? null,
    lockOwner: null as string | null,
  }
  const supabase = fakeSupabase({
    rpc: {
      get_sms_provider_context: () => ({
        data: {
          module_enabled: options.moduleEnabled ?? true,
          clinic_name: 'Clinique MANA',
          base_url: BASE,
          client_id: FAKE_YEASTAR_CLIENT_ID,
          client_secret: FAKE_YEASTAR_CLIENT_SECRET,
          did: FAKE_YEASTAR_DID,
          ...options.settings,
          session: state.session,
          channel: state.channel,
        },
      }),
      acquire_sms_provider_lock: (args) => {
        if (options.otherIsolateRefreshes && !state.session) {
          state.session = {
            base_url: 'http://pbx.test',
            access_token: 'fake-access-other',
            refresh_token: null,
            access_expires_at: '2027-03-10T15:25:00Z',
            refresh_expires_at: null,
          }
          fake.tokens.set(
            'fake-access-other',
            Date.parse('2027-03-10T15:25:00Z'),
          )
          return { data: false }
        }
        if (state.lockOwner && state.lockOwner !== args.p_owner) {
          return { data: false }
        }
        state.lockOwner = args.p_owner as string
        return { data: true }
      },
      release_sms_provider_lock: (args) => {
        if (state.lockOwner === args.p_owner) state.lockOwner = null
        return { data: null }
      },
      store_sms_provider_session: (args) => {
        state.session = {
          base_url: args.p_base_url as string,
          access_token: args.p_access_token as string,
          refresh_token: args.p_refresh_token as string | null,
          access_expires_at: args.p_access_expires_at as string,
          refresh_expires_at: args.p_refresh_expires_at as string | null,
        }
        return { data: null }
      },
      set_sms_provider_channel: (args) => {
        state.channel = args.p_channel_name as string
        return { data: null }
      },
      ...options.rpc,
    },
  })
  const env: Record<string, string | undefined> = {
    APP_URL: 'http://localhost:5173',
    YEASTAR_BASE_URL: 'http://pbx.test',
    ...options.env,
  }
  const deps: TransportDeps = {
    client: supabase.client,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init)
      origins.push(new URL(req.url).origin)
      return fake.handler(req)
    }) as typeof fetch,
    now: clock.now,
    env: (key) => env[key],
  }
  return {
    transport: createYeastarTransport(deps),
    fake,
    supabase,
    state,
    clock,
    origins,
  }
}

const TEXT = { to: '+15145551234', body: 'Bonjour', requestId: 'mana-1' }
const rpcNames = (s: ReturnType<typeof setup>) =>
  s.supabase.calls.map((c) => c.fn)

Deno.test('send: first time, tokens are requested under the lease, stored, the channel found and cached, the text sent', async () => {
  const s = setup()
  const sent = await s.transport.send(ORG, TEXT)
  assertEquals(sent, { msgId: 10000, sessionId: 3000 })
  assertEquals(s.fake.tokenCalls, ['get_token'])
  assertEquals(s.state.session?.access_token, 'fake-access-1')
  assertEquals(
    s.state.session?.base_url,
    'http://pbx.test',
    'the local override is the session address',
  )
  assertEquals(s.state.channel, 'general')
  assertEquals(s.state.lockOwner, null, 'the lease is released')
  assertEquals(rpcNames(s), [
    'get_sms_provider_context',
    'acquire_sms_provider_lock',
    'get_sms_provider_context',
    'store_sms_provider_session',
    'release_sms_provider_lock',
    'set_sms_provider_channel',
  ])
  assertEquals(
    s.fake.messages[0].did,
    FAKE_YEASTAR_DID,
    'sent from the clinic number',
  )
  assertEquals(s.fake.messages[0].channel, 'general')
})

Deno.test('send: a stored token still good for a minute is reused, no PBX token call', async () => {
  const s = setup({
    session: {
      base_url: 'http://pbx.test',
      access_token: 'fake-access-9',
      refresh_token: 'fake-refresh-9',
      access_expires_at: '2027-03-10T15:10:00Z',
      refresh_expires_at: '2027-03-11T00:00:00Z',
    },
    channel: 'general',
  })
  s.fake.tokens.set('fake-access-9', Date.parse('2027-03-10T15:10:00Z'))
  await s.transport.send(ORG, TEXT)
  assertEquals(s.fake.tokenCalls, [])
  assertEquals(rpcNames(s), ['get_sms_provider_context'])
})

Deno.test('send: a token about to expire is refreshed from the refresh token', async () => {
  const s = setup({
    session: {
      base_url: 'http://pbx.test',
      access_token: 'fake-access-0',
      refresh_token: 'fake-refresh-1',
      access_expires_at: '2027-03-10T15:00:30Z',
      refresh_expires_at: '2027-03-11T00:00:00Z',
    },
    channel: 'general',
  })
  // The PBX knows that refresh token (issued by a first get_token).
  await s.fake.handler(
    new Request('http://pbx.test/openapi/v1.0/get_token', {
      method: 'POST',
      body: JSON.stringify({
        username: FAKE_YEASTAR_CLIENT_ID,
        password: FAKE_YEASTAR_CLIENT_SECRET,
      }),
    }),
  )
  s.fake.tokenCalls.length = 0
  await s.transport.send(ORG, TEXT)
  assertEquals(s.fake.tokenCalls, ['refresh_token'])
  assertEquals(s.state.session?.access_token, 'fake-access-2')
})

Deno.test('send: a refresh token the PBX refuses falls back to new tokens', async () => {
  const s = setup({
    session: {
      base_url: 'http://pbx.test',
      access_token: 'fake-access-0',
      refresh_token: 'unknown-refresh',
      access_expires_at: '2027-03-10T14:00:00Z',
      refresh_expires_at: '2027-03-11T00:00:00Z',
    },
    channel: 'general',
  })
  await s.transport.send(ORG, TEXT)
  assertEquals(s.fake.tokenCalls, ['refresh_token', 'get_token'])
})

Deno.test('send: a token the PBX dropped gets one retry with new tokens', async () => {
  const s = setup({
    session: {
      base_url: 'http://pbx.test',
      access_token: 'fake-access-dropped',
      refresh_token: null,
      access_expires_at: '2027-03-10T15:20:00Z',
      refresh_expires_at: null,
    },
    channel: 'general',
  })
  await s.transport.send(ORG, TEXT)
  assertEquals(s.fake.tokenCalls, ['get_token'])
  assertEquals(s.fake.messages.length, 1)
})

Deno.test('send: the clinic PBX settings incomplete → not_configured; the module off → module_disabled', async () => {
  const missing = await assertRejects(
    () => setup({ settings: { did: null } }).transport.send(ORG, TEXT),
    SmsTransportError,
  )
  assertEquals(missing.code, 'not_configured')
  const noSecret = await assertRejects(
    () =>
      setup({ settings: { client_secret: null } }).transport.send(ORG, TEXT),
    SmsTransportError,
  )
  assertEquals(noSecret.code, 'not_configured')
  const off = await assertRejects(
    () => setup({ moduleEnabled: false }).transport.send(ORG, TEXT),
    SmsTransportError,
  )
  assertEquals(off.code, 'module_disabled')
})

Deno.test('send: the local override applies only with a local APP_URL', async () => {
  const local = setup()
  await local.transport.send(ORG, TEXT)
  assertEquals(local.origins[0], 'http://pbx.test', 'local: the fake')
  const hosted = setup({ env: { APP_URL: 'https://app.cliniquemana.com' } })
  await hosted.transport.send(ORG, TEXT)
  assertEquals(
    hosted.origins[0],
    'https://pbx.test',
    'hosted: the clinic address, whatever the env says',
  )
})

Deno.test('send: a refused number is provider_rejected and the row-level caller decides', async () => {
  const s = setup()
  const error = await assertRejects(
    () => s.transport.send(ORG, { ...TEXT, to: '+15145550000' }),
    SmsTransportError,
  )
  assertEquals(error.code, 'provider_rejected')
})

Deno.test('send: the token cap is token_limit, the lease is released', async () => {
  const s = setup({ pbx: { tokenLimit: true } })
  const error = await assertRejects(
    () => s.transport.send(ORG, TEXT),
    SmsTransportError,
  )
  assertEquals(error.code, 'token_limit')
  assertEquals(s.state.lockOwner, null)
})

Deno.test('send: a lease held by another isolate that refreshed meanwhile is read, not fought', async () => {
  const s = setup({ otherIsolateRefreshes: true })
  await s.transport.send(ORG, TEXT)
  assertEquals(s.fake.tokenCalls, [], 'the other isolate token is used')
  assertEquals(s.state.session?.access_token, 'fake-access-other')
})

Deno.test('sessionOwner: the clinic session, another tenant session, an unknown session', async () => {
  const s = setup()
  await s.transport.send(ORG, TEXT)
  assertEquals(await s.transport.sessionOwner(ORG, 3000), { ours: true })
  s.fake.foreignSession(4242, '+15145550000')
  assertEquals(await s.transport.sessionOwner(ORG, 4242), { ours: false })
  const unknown = await assertRejects(
    () => s.transport.sessionOwner(ORG, 9),
    SmsTransportError,
  )
  assertEquals(unknown.code, 'provider_rejected')
})

Deno.test('a failing RPC is internal, reported with ids only', async () => {
  const s = setup({
    rpc: { store_sms_provider_session: { error: { code: '42501' } } },
  })
  const lines = await captureConsole('error', async () => {
    await withEnv({ SENTRY_DSN: undefined }, async () => {
      const error = await assertRejects(
        () => s.transport.send(ORG, TEXT),
        SmsTransportError,
      )
      assertEquals(error.code, 'internal')
    })
  })
  assertEquals(lines, [])
  assertEquals(s.state.lockOwner, null, 'the lease is released on the way out')
})

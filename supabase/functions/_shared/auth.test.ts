import { assert, assertEquals } from '@std/assert'
import {
  AuthRetryableFetchError,
  type SupabaseClient,
} from '@supabase/supabase-js'
import {
  authorizeCaller,
  bearerToken,
  corsHeaders,
  type ErrorCode,
  errorResponse,
  evaluateAccess,
  getServiceRoleClient,
  getUserClient,
  handleCors,
  jsonResponse,
  serviceKeys,
  verifyAuth,
  verifyServiceRoleAuth,
} from './auth.ts'
import { captureConsole, withEnv } from './testing/env.ts'

const ACTIVE = {
  user_id: 'u1',
  org_id: 'o1',
  status: 'active',
  role: 'admin_assistant',
  permissions: ['professionals.view', 'settings.view'],
  modules: ['professionals'],
}

type ErrorBody = { error: { code: string; message: string } }

async function errorOf(res: Response): Promise<ErrorBody['error']> {
  return ((await res.json()) as ErrorBody).error
}

const NO_SERVICE_KEYS = {
  SUPABASE_SERVICE_ROLE_KEY: undefined,
  SUPABASE_SECRET_KEYS: undefined,
  INTERNAL_FUNCTION_SECRET: undefined,
}

// ---------------------------------------------------------------------------
// Responses and error codes
// ---------------------------------------------------------------------------
Deno.test('errorResponse: { error: { code, message } } as JSON', async () => {
  const res = errorResponse('forbidden', 'Nope', 403)
  assertEquals(res.status, 403)
  assertEquals(res.headers.get('Content-Type'), 'application/json')
  assertEquals(await res.json(), {
    error: { code: 'forbidden', message: 'Nope' },
  })
})

Deno.test('errorResponse: the Phase 3 codes (P3-28) with their statuses', async () => {
  const codes: Array<[ErrorCode, number]> = [
    ['rate_limited', 429],
    ['invalid_request', 400],
    ['link_invalid', 410],
    ['link_expired', 410],
    ['link_used', 410],
    ['conflict', 409],
    ['not_found', 404],
    ['provider_error', 502],
    ['not_configured', 503],
  ]
  for (const [code, status] of codes) {
    const res = errorResponse(code, 'Message', status)
    assertEquals(res.status, status)
    assertEquals((await errorOf(res)).code, code)
  }
})

Deno.test('jsonResponse: JSON body, content type and CORS headers', async () => {
  await withEnv({ ALLOWED_ORIGINS: undefined }, async () => {
    const res = jsonResponse({ ok: true }, 201)
    assertEquals(res.status, 201)
    assertEquals(res.headers.get('Content-Type'), 'application/json')
    assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
    assertEquals(await res.json(), { ok: true })
  })
})

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const fromOrigin = (origin: string, method = 'POST') =>
  new Request('http://x', { method, headers: { Origin: origin } })

Deno.test('corsHeaders: * when ALLOWED_ORIGINS is unset; no Content-Type', async () => {
  await withEnv({ ALLOWED_ORIGINS: undefined }, () => {
    const h = corsHeaders(fromOrigin('https://evil.test'))
    assertEquals(h['Access-Control-Allow-Origin'], '*')
    assertEquals(h['Access-Control-Allow-Methods'], 'GET, POST, OPTIONS')
    assert(h['Access-Control-Allow-Headers'].includes('authorization'))
    assertEquals(h['Content-Type'], undefined)
  })
})

Deno.test('corsHeaders: echoes an allowed origin with Vary: Origin', async () => {
  await withEnv(
    { ALLOWED_ORIGINS: 'https://app.test, http://localhost:5173' },
    () => {
      const h = corsHeaders(fromOrigin('http://localhost:5173'))
      assertEquals(h['Access-Control-Allow-Origin'], 'http://localhost:5173')
      assertEquals(h['Vary'], 'Origin')
    },
  )
})

Deno.test('corsHeaders: no allow-origin for an origin not in the list', async () => {
  await withEnv({ ALLOWED_ORIGINS: 'https://app.test' }, () => {
    const h = corsHeaders(fromOrigin('https://evil.test'))
    assertEquals(h['Access-Control-Allow-Origin'], undefined)
    assertEquals(h['Vary'], 'Origin')
  })
})

Deno.test('handleCors: answers OPTIONS with the request origin, ignores other methods', async () => {
  await withEnv({ ALLOWED_ORIGINS: 'https://app.test' }, () => {
    const preflight = handleCors(fromOrigin('https://app.test', 'OPTIONS'))
    assert(preflight instanceof Response)
    assertEquals(preflight.status, 200)
    assertEquals(
      preflight.headers.get('Access-Control-Allow-Origin'),
      'https://app.test',
    )
    assertEquals(handleCors(fromOrigin('https://app.test')), null)
  })
})

// ---------------------------------------------------------------------------
// bearerToken
// ---------------------------------------------------------------------------
Deno.test('bearerToken: extracts the token, case-insensitive scheme', () => {
  const req = (h: string) =>
    new Request('http://x', { headers: { Authorization: h } })
  assertEquals(bearerToken(req('Bearer abc.def')), 'abc.def')
  assertEquals(bearerToken(req('bearer   abc')), 'abc')
})

Deno.test('bearerToken: null when missing, empty or not a bearer token', () => {
  const req = (h: string) =>
    new Request('http://x', { headers: { Authorization: h } })
  assertEquals(bearerToken(new Request('http://x')), null)
  assertEquals(bearerToken(req('Bearer ')), null)
  assertEquals(bearerToken(req('Basic abc')), null)
})

// ---------------------------------------------------------------------------
// evaluateAccess (pure decision on the get_my_access RPC result)
// ---------------------------------------------------------------------------
Deno.test('evaluateAccess: active user with the permission is allowed', () => {
  const d = evaluateAccess({ data: ACTIVE, error: null }, {
    permission: 'professionals.view',
  })
  assert(d.ok)
  assertEquals(d.access.org_id, 'o1')
})

Deno.test('evaluateAccess: active user without options is allowed', () => {
  assert(evaluateAccess({ data: ACTIVE, error: null }).ok)
})

Deno.test('evaluateAccess: missing permission gives 403 forbidden', () => {
  const d = evaluateAccess({ data: ACTIVE, error: null }, {
    permission: 'settings.manage',
  })
  assert(!d.ok)
  assertEquals([d.status, d.code], [403, 'forbidden'])
  assertEquals(d.message, 'Permission required: settings.manage')
})

Deno.test('evaluateAccess: module option passes for an enabled module', () => {
  assert(
    evaluateAccess({ data: ACTIVE, error: null }, { module: 'professionals' })
      .ok,
  )
})

Deno.test('evaluateAccess: disabled module gives 403 module_disabled (before the permission)', () => {
  const d = evaluateAccess({ data: { ...ACTIVE, modules: [] }, error: null }, {
    module: 'professionals',
    permission: 'professionals.view',
  })
  assert(!d.ok)
  assertEquals([d.status, d.code], [403, 'module_disabled'])
})

Deno.test('evaluateAccess: null result (no profile) gives 403 forbidden', () => {
  const d = evaluateAccess({ data: null, error: null }, {
    permission: 'professionals.view',
  })
  assert(!d.ok)
  assertEquals([d.status, d.code], [403, 'forbidden'])
})

Deno.test('evaluateAccess: inactive profile gives 403 even if permissions were listed', () => {
  const d = evaluateAccess({
    data: { ...ACTIVE, status: 'disabled' },
    error: null,
  }, { permission: 'professionals.view' })
  assert(!d.ok)
  assertEquals(d.status, 403)
  const noOptions = evaluateAccess({
    data: { ...ACTIVE, status: 'invited' },
    error: null,
  })
  assert(!noOptions.ok)
  assertEquals(noOptions.status, 403)
})

Deno.test('evaluateAccess: malformed payload fails closed (403)', () => {
  for (
    const data of [
      'nope',
      42,
      [],
      { ...ACTIVE, permissions: 'professionals.view' },
      { ...ACTIVE, org_id: null },
    ]
  ) {
    const d = evaluateAccess({ data, error: null }, {
      permission: 'professionals.view',
    })
    assert(!d.ok, JSON.stringify(data))
    assertEquals(d.status, 403)
  }
})

Deno.test('evaluateAccess: RPC error 42501 gives 401 unauthenticated', () => {
  const d = evaluateAccess({
    data: null,
    error: { code: '42501', message: 'permission denied' },
  })
  assert(!d.ok)
  assertEquals([d.status, d.code], [401, 'unauthenticated'])
})

Deno.test('evaluateAccess: any other RPC error gives 500 internal', () => {
  const d = evaluateAccess({
    data: null,
    error: { code: 'PGRST000', message: 'boom' },
  })
  assert(!d.ok)
  assertEquals([d.status, d.code], [500, 'internal'])
})

// ---------------------------------------------------------------------------
// authorizeCaller (verifyAuth minus client construction) with a fake client
// ---------------------------------------------------------------------------
type FakeOptions = {
  user?: { id: string } | null
  userError?: unknown
  access?: {
    data: unknown
    error: { code?: string; message?: string } | null
  }
}

function fakeClient(o: FakeOptions) {
  const calls: { getUser: string[]; rpc: string[] } = { getUser: [], rpc: [] }
  const client = {
    auth: {
      getUser: (jwt: string) => {
        calls.getUser.push(jwt)
        return Promise.resolve({
          data: { user: o.user ?? null },
          error: o.userError ?? null,
        })
      },
    },
    rpc: (fn: string) => {
      calls.rpc.push(fn)
      return Promise.resolve(o.access ?? { data: ACTIVE, error: null })
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

Deno.test('authorizeCaller: validates the token with auth.getUser(token)', async () => {
  const { client, calls } = fakeClient({ user: { id: 'u1' } })
  const result = await authorizeCaller(client, 'tok', {
    permission: 'professionals.view',
  })
  assert(!(result instanceof Response))
  assertEquals(calls.getUser, ['tok'])
  assertEquals(calls.rpc, ['get_my_access'])
  assertEquals(result.access.org_id, 'o1')
  assertEquals(result.user.id, 'u1')
})

Deno.test('authorizeCaller: invalid token gives 401 and skips the access RPC', async () => {
  const { client, calls } = fakeClient({
    user: null,
    userError: Object.assign(new Error('bad jwt'), { status: 401 }),
  })
  const result = await authorizeCaller(client, 'tok')
  assert(result instanceof Response)
  assertEquals(result.status, 401)
  assertEquals((await errorOf(result)).code, 'unauthenticated')
  assertEquals(calls.rpc, [])
})

Deno.test('authorizeCaller: Auth server error (5xx) gives 503 auth_unavailable', async () => {
  const { client } = fakeClient({
    user: null,
    userError: Object.assign(new Error('upstream'), { status: 502 }),
  })
  const logged = await captureConsole('error', async () => {
    const result = await authorizeCaller(client, 'tok')
    assert(result instanceof Response)
    assertEquals(result.status, 503)
    assertEquals((await errorOf(result)).code, 'auth_unavailable')
  })
  assertEquals(logged.length, 1)
})

Deno.test('authorizeCaller: network failure (AuthRetryableFetchError) gives 503', async () => {
  const { client } = fakeClient({
    user: null,
    userError: new AuthRetryableFetchError('fetch failed', 0),
  })
  await captureConsole('error', async () => {
    const result = await authorizeCaller(client, 'tok')
    assert(result instanceof Response)
    assertEquals(result.status, 503)
  })
})

Deno.test('authorizeCaller: 42501 after a valid token is logged (missing grant)', async () => {
  const { client } = fakeClient({
    user: { id: 'u1' },
    access: { data: null, error: { code: '42501', message: 'denied' } },
  })
  const logged = await captureConsole('error', async () => {
    const result = await authorizeCaller(client, 'tok')
    assert(result instanceof Response)
    assertEquals(result.status, 401)
  })
  assertEquals(logged.length, 1)
})

Deno.test('authorizeCaller: other RPC errors give 500 and are logged', async () => {
  const { client } = fakeClient({
    user: { id: 'u1' },
    access: { data: null, error: { code: 'XX000', message: 'boom' } },
  })
  const logged = await captureConsole('error', async () => {
    const result = await authorizeCaller(client, 'tok')
    assert(result instanceof Response)
    assertEquals(result.status, 500)
  })
  assertEquals(logged.length, 1)
})

Deno.test('authorizeCaller: inactive caller is refused even without options', async () => {
  const { client } = fakeClient({
    user: { id: 'u1' },
    access: { data: { ...ACTIVE, status: 'disabled' }, error: null },
  })
  const result = await authorizeCaller(client, 'tok')
  assert(result instanceof Response)
  assertEquals(result.status, 403)
})

Deno.test('authorizeCaller: missing permission gives 403 forbidden', async () => {
  const { client } = fakeClient({ user: { id: 'u1' } })
  const result = await authorizeCaller(client, 'tok', {
    permission: 'settings.manage',
  })
  assert(result instanceof Response)
  assertEquals(result.status, 403)
  assertEquals(await errorOf(result), {
    code: 'forbidden',
    message: 'Permission required: settings.manage',
  })
})

Deno.test('authorizeCaller: module option refuses a disabled module without an extra RPC', async () => {
  const { client, calls } = fakeClient({ user: { id: 'u1' } })
  const result = await authorizeCaller(client, 'tok', { module: 'billing' })
  assert(result instanceof Response)
  assertEquals((await errorOf(result)).code, 'module_disabled')
  assertEquals(calls.rpc, ['get_my_access'])
})

// ---------------------------------------------------------------------------
// verifyAuth and client factories (no network: paths that fail early)
// ---------------------------------------------------------------------------
Deno.test('verifyAuth: missing Authorization header gives 401 unauthenticated', async () => {
  const result = await verifyAuth(new Request('http://x'))
  assert(result instanceof Response)
  assertEquals(result.status, 401)
  assertEquals((await errorOf(result)).code, 'unauthenticated')
})

Deno.test('verifyAuth: missing SUPABASE_URL / anon key gives 500 server_misconfigured', async () => {
  await withEnv(
    { SUPABASE_URL: undefined, SUPABASE_ANON_KEY: 'anon' },
    async () => {
      const logged = await captureConsole('error', async () => {
        const result = await verifyAuth(
          new Request('http://x', { headers: { Authorization: 'Bearer tok' } }),
        )
        assert(result instanceof Response)
        assertEquals(result.status, 500)
        assertEquals((await errorOf(result)).code, 'server_misconfigured')
      })
      assertEquals(logged.length, 1)
    },
  )
})

Deno.test('getUserClient / getServiceRoleClient: Response when env is missing', async () => {
  await withEnv(
    {
      SUPABASE_URL: 'http://127.0.0.1:1',
      SUPABASE_ANON_KEY: undefined,
      ...NO_SERVICE_KEYS,
    },
    async () => {
      await captureConsole('error', () => {
        assert(getUserClient('tok') instanceof Response)
        assert(getServiceRoleClient() instanceof Response)
      })
    },
  )
})

Deno.test('getUserClient: a client when env is set', async () => {
  await withEnv(
    { SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_ANON_KEY: 'anon' },
    () => {
      assert(!(getUserClient('tok') instanceof Response))
    },
  )
})

// ---------------------------------------------------------------------------
// verifyServiceRoleAuth (several accepted keys)
// ---------------------------------------------------------------------------
const authReq = (h?: string) =>
  new Request(
    'http://x',
    h === undefined ? undefined : { headers: { Authorization: h } },
  )

const ALL_KEYS = {
  SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-jwt',
  SUPABASE_SECRET_KEYS: 'sb_secret_one, sb_secret_two',
  INTERNAL_FUNCTION_SECRET: 'internal-secret',
}

Deno.test('serviceKeys: collects every configured key, ignoring empty values', async () => {
  await withEnv(
    { ...ALL_KEYS, SUPABASE_SECRET_KEYS: 'sb_secret_one,, ' },
    () => {
      assertEquals(serviceKeys(), [
        'legacy-service-jwt',
        'sb_secret_one',
        'internal-secret',
      ])
    },
  )
  await withEnv({ ...NO_SERVICE_KEYS, INTERNAL_FUNCTION_SECRET: '' }, () => {
    assertEquals(serviceKeys(), [])
  })
})

Deno.test('verifyServiceRoleAuth: fails closed (500) when no key is configured', async () => {
  await withEnv(NO_SERVICE_KEYS, async () => {
    await captureConsole('error', async () => {
      const res = verifyServiceRoleAuth(authReq('Bearer anything'))
      assertEquals(res?.status, 500)
      assertEquals((await errorOf(res!)).code, 'server_misconfigured')
    })
  })
})

Deno.test('verifyServiceRoleAuth: accepts the legacy service-role key', async () => {
  await withEnv(ALL_KEYS, () => {
    assertEquals(
      verifyServiceRoleAuth(authReq('Bearer legacy-service-jwt')),
      null,
    )
  })
})

Deno.test('verifyServiceRoleAuth: accepts each sb_secret_ key', async () => {
  await withEnv(ALL_KEYS, () => {
    assertEquals(verifyServiceRoleAuth(authReq('Bearer sb_secret_one')), null)
    assertEquals(verifyServiceRoleAuth(authReq('Bearer sb_secret_two')), null)
  })
})

Deno.test('verifyServiceRoleAuth: accepts the internal function secret', async () => {
  await withEnv(ALL_KEYS, () => {
    assertEquals(verifyServiceRoleAuth(authReq('Bearer internal-secret')), null)
  })
})

Deno.test('verifyServiceRoleAuth: wrong or missing key gives 401 unauthenticated', async () => {
  await withEnv(ALL_KEYS, async () => {
    const wrong = verifyServiceRoleAuth(authReq('Bearer sb_secret_on'))
    assertEquals(wrong?.status, 401)
    assertEquals((await errorOf(wrong!)).code, 'unauthenticated')
    assertEquals(verifyServiceRoleAuth(authReq('Bearer user-jwt'))?.status, 401)
    assertEquals(verifyServiceRoleAuth(authReq())?.status, 401)
  })
})

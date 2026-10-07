import { assert, assertEquals } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  authorizeCaller,
  bearerToken,
  evaluateAccess,
  handleCors,
  verifyAuth,
  verifyServiceRoleAuth,
} from './auth.ts'

const ACTIVE = {
  user_id: 'u1',
  org_id: 'o1',
  status: 'active',
  role: 'staff',
  permissions: ['professionals.view', 'settings.view'],
  modules: ['professionals'],
}

async function body(res: Response): Promise<unknown> {
  return await res.json()
}

// ---------------------------------------------------------------------------
// bearerToken
// ---------------------------------------------------------------------------
Deno.test('bearerToken: extracts the token, case-insensitive scheme', () => {
  const req = (h: string) => new Request('http://x', { headers: { Authorization: h } })
  assertEquals(bearerToken(req('Bearer abc.def')), 'abc.def')
  assertEquals(bearerToken(req('bearer   abc')), 'abc')
})

Deno.test('bearerToken: null when missing, empty or not a bearer token', () => {
  assertEquals(bearerToken(new Request('http://x')), null)
  assertEquals(bearerToken(new Request('http://x', { headers: { Authorization: 'Bearer ' } })), null)
  assertEquals(bearerToken(new Request('http://x', { headers: { Authorization: 'Basic abc' } })), null)
})

// ---------------------------------------------------------------------------
// evaluateAccess (pure decision on the get_my_access RPC result)
// ---------------------------------------------------------------------------
Deno.test('evaluateAccess: active user with the permission is allowed', () => {
  const d = evaluateAccess({ data: ACTIVE, error: null }, 'professionals.view')
  assert(d.ok)
  assertEquals(d.access.org_id, 'o1')
})

Deno.test('evaluateAccess: active user without a permission option is allowed', () => {
  assert(evaluateAccess({ data: ACTIVE, error: null }).ok)
})

Deno.test('evaluateAccess: missing permission gives 403', () => {
  const d = evaluateAccess({ data: ACTIVE, error: null }, 'settings.manage')
  assert(!d.ok)
  assertEquals(d.status, 403)
  assertEquals(d.message, 'Permission required: settings.manage')
})

Deno.test('evaluateAccess: null result (no profile) gives 403', () => {
  const d = evaluateAccess({ data: null, error: null }, 'professionals.view')
  assert(!d.ok)
  assertEquals(d.status, 403)
})

Deno.test('evaluateAccess: inactive profile gives 403 even if permissions were listed', () => {
  const d = evaluateAccess({ data: { ...ACTIVE, status: 'disabled' }, error: null }, 'professionals.view')
  assert(!d.ok)
  assertEquals(d.status, 403)
  const noPermOption = evaluateAccess({ data: { ...ACTIVE, status: 'invited' }, error: null })
  assert(!noPermOption.ok)
  assertEquals(noPermOption.status, 403)
})

Deno.test('evaluateAccess: malformed payload fails closed (403)', () => {
  for (const data of ['nope', 42, [], { ...ACTIVE, permissions: 'professionals.view' }, { ...ACTIVE, org_id: null }]) {
    const d = evaluateAccess({ data, error: null }, 'professionals.view')
    assert(!d.ok, JSON.stringify(data))
    assertEquals(d.status, 403)
  }
})

Deno.test('evaluateAccess: RPC error 42501 (not authenticated) gives 401', () => {
  const d = evaluateAccess({ data: null, error: { code: '42501', message: 'permission denied' } }, 'x.y')
  assert(!d.ok)
  assertEquals(d.status, 401)
})

Deno.test('evaluateAccess: any other RPC error gives 500', () => {
  const d = evaluateAccess({ data: null, error: { code: 'PGRST000', message: 'boom' } }, 'x.y')
  assert(!d.ok)
  assertEquals(d.status, 500)
})

// ---------------------------------------------------------------------------
// authorizeCaller (verifyAuth minus client construction) with a fake client
// ---------------------------------------------------------------------------
type FakeOptions = {
  user?: { id: string } | null
  userError?: unknown
  access?: { data: unknown; error: { code?: string; message?: string } | null }
}

function fakeClient(o: FakeOptions) {
  const calls: { getUser: string[]; rpc: string[] } = { getUser: [], rpc: [] }
  const client = {
    auth: {
      getUser: (jwt: string) => {
        calls.getUser.push(jwt)
        return Promise.resolve({ data: { user: o.user ?? null }, error: o.userError ?? null })
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
  const result = await authorizeCaller(client, 'tok', { permission: 'professionals.view' })
  assert(!(result instanceof Response))
  assertEquals(calls.getUser, ['tok'])
  assertEquals(calls.rpc, ['get_my_access'])
  assertEquals(result.access.org_id, 'o1')
  assertEquals(result.user.id, 'u1')
})

Deno.test('authorizeCaller: invalid token gives 401 and skips the access RPC', async () => {
  const { client, calls } = fakeClient({ user: null, userError: new Error('bad jwt') })
  const result = await authorizeCaller(client, 'tok', { permission: 'professionals.view' })
  assert(result instanceof Response)
  assertEquals(result.status, 401)
  assertEquals(calls.rpc, [])
})

Deno.test('authorizeCaller: inactive caller is refused even without a permission option', async () => {
  const { client } = fakeClient({ user: { id: 'u1' }, access: { data: { ...ACTIVE, status: 'disabled' }, error: null } })
  const result = await authorizeCaller(client, 'tok')
  assert(result instanceof Response)
  assertEquals(result.status, 403)
})

Deno.test('authorizeCaller: missing permission gives 403 with a JSON error body', async () => {
  const { client } = fakeClient({ user: { id: 'u1' } })
  const result = await authorizeCaller(client, 'tok', { permission: 'settings.manage' })
  assert(result instanceof Response)
  assertEquals(result.status, 403)
  assertEquals(await body(result), { error: 'Permission required: settings.manage' })
})

// ---------------------------------------------------------------------------
// verifyAuth (no network: only the paths that fail before any request)
// ---------------------------------------------------------------------------
Deno.test('verifyAuth: missing Authorization header gives 401', async () => {
  const result = await verifyAuth(new Request('http://x'))
  assert(result instanceof Response)
  assertEquals(result.status, 401)
})

// ---------------------------------------------------------------------------
// verifyServiceRoleAuth
// ---------------------------------------------------------------------------
function withServiceKey(value: string | undefined, fn: () => void) {
  const previous = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (value === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
  else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', value)
  try {
    fn()
  } finally {
    if (previous === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY')
    else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', previous)
  }
}

const authReq = (h?: string) =>
  new Request('http://x', h === undefined ? undefined : { headers: { Authorization: h } })

Deno.test('verifyServiceRoleAuth: fails closed (500) when the key is not configured', () => {
  withServiceKey(undefined, () => {
    assertEquals(verifyServiceRoleAuth(authReq('Bearer anything'))?.status, 500)
  })
})

Deno.test('verifyServiceRoleAuth: missing token gives 401', () => {
  withServiceKey('service-key', () => {
    assertEquals(verifyServiceRoleAuth(authReq())?.status, 401)
  })
})

Deno.test('verifyServiceRoleAuth: wrong token gives 401', () => {
  withServiceKey('service-key', () => {
    assertEquals(verifyServiceRoleAuth(authReq('Bearer service-kez'))?.status, 401)
    assertEquals(verifyServiceRoleAuth(authReq('Bearer user-jwt'))?.status, 401)
  })
})

Deno.test('verifyServiceRoleAuth: correct token passes (null)', () => {
  withServiceKey('service-key', () => {
    assertEquals(verifyServiceRoleAuth(authReq('Bearer service-key')), null)
  })
})

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
Deno.test('handleCors: answers OPTIONS preflight, ignores other methods', () => {
  const preflight = handleCors(new Request('http://x', { method: 'OPTIONS' }))
  assert(preflight instanceof Response)
  assertEquals(preflight.status, 200)
  assert(preflight.headers.get('Access-Control-Allow-Headers')?.includes('authorization'))
  assertEquals(handleCors(new Request('http://x', { method: 'POST' })), null)
})

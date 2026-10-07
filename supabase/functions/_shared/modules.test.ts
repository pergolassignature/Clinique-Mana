import { assertEquals } from '@std/assert'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireModule, requireModuleForOrg } from './modules.ts'

type RpcResult = {
  data: unknown
  error: { code?: string; message?: string } | null
}

function fakeClient(result: RpcResult) {
  const calls: Array<{ fn: string; args: unknown }> = []
  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args })
      return Promise.resolve(result)
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

async function silenced<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = original
  }
}

// ---------------------------------------------------------------------------
// requireModule (caller's client, caller's org)
// ---------------------------------------------------------------------------
Deno.test('requireModule: enabled module passes (null) and calls module_enabled', async () => {
  const { client, calls } = fakeClient({ data: true, error: null })
  assertEquals(await requireModule(client, 'professionals'), null)
  assertEquals(calls, [{
    fn: 'module_enabled',
    args: { p_key: 'professionals' },
  }])
})

Deno.test('requireModule: disabled module gives 403 module_disabled', async () => {
  const { client } = fakeClient({ data: false, error: null })
  const res = await requireModule(client, 'professionals')
  assertEquals(res?.status, 403)
  assertEquals(await res?.json(), {
    error: {
      code: 'module_disabled',
      message: 'Module disabled: professionals',
    },
  })
})

Deno.test('requireModule: non-boolean result fails closed (403)', async () => {
  const { client } = fakeClient({ data: null, error: null })
  assertEquals((await requireModule(client, 'professionals'))?.status, 403)
})

Deno.test('requireModule: RPC error gives 500 internal', async () => {
  const { client } = fakeClient({
    data: null,
    error: { code: 'PGRST000', message: 'boom' },
  })
  const res = await silenced(() => requireModule(client, 'professionals'))
  assertEquals(res?.status, 500)
  assertEquals((await res?.json()).error.code, 'internal')
})

// ---------------------------------------------------------------------------
// requireModuleForOrg (service-role client, org resolved from a database row)
// ---------------------------------------------------------------------------
Deno.test('requireModuleForOrg: enabled module passes and calls module_enabled_for_org', async () => {
  const { client, calls } = fakeClient({ data: true, error: null })
  assertEquals(
    await requireModuleForOrg(client, 'org-1', 'professionals'),
    null,
  )
  assertEquals(calls, [{
    fn: 'module_enabled_for_org',
    args: { p_org_id: 'org-1', p_key: 'professionals' },
  }])
})

Deno.test('requireModuleForOrg: disabled module gives 403 module_disabled', async () => {
  const { client } = fakeClient({ data: false, error: null })
  const res = await requireModuleForOrg(client, 'org-1', 'professionals')
  assertEquals(res?.status, 403)
  assertEquals((await res?.json()).error.code, 'module_disabled')
})

Deno.test('requireModuleForOrg: non-boolean result fails closed (403)', async () => {
  const { client } = fakeClient({ data: null, error: null })
  assertEquals(
    (await requireModuleForOrg(client, 'org-1', 'professionals'))?.status,
    403,
  )
})

Deno.test('requireModuleForOrg: RPC error gives 500 internal', async () => {
  const { client } = fakeClient({
    data: null,
    error: { code: '42501', message: 'denied' },
  })
  const res = await silenced(() =>
    requireModuleForOrg(client, 'org-1', 'professionals')
  )
  assertEquals(res?.status, 500)
})

Deno.test('requireModuleForOrg: missing org id fails closed without an RPC', async () => {
  const { client, calls } = fakeClient({ data: true, error: null })
  const res = await silenced(() =>
    requireModuleForOrg(client, '', 'professionals')
  )
  assertEquals(res?.status, 500)
  assertEquals(calls, [])
})

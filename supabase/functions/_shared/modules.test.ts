import { assertEquals } from '@std/assert'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireModuleForOrg } from './modules.ts'

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

Deno.test('requireModuleForOrg: RPC error gives 500 internal, logged with its code only', async () => {
  const { client } = fakeClient({
    data: null,
    error: { code: 'PGRST000', message: 'boom: ana@example.com' },
  })
  const logged: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => logged.push(args)
  let res: Response | null
  try {
    res = await requireModuleForOrg(client, 'org-1', 'professionals')
  } finally {
    console.error = original
  }
  assertEquals(res?.status, 500)
  assertEquals((await res?.json()).error.code, 'internal')
  assertEquals(logged, [[
    '[requireModule] module_enabled_for_org failed (code=PGRST000)',
  ]])
})

Deno.test('requireModuleForOrg: missing org id fails closed without an RPC', async () => {
  const { client, calls } = fakeClient({ data: true, error: null })
  const res = await silenced(() =>
    requireModuleForOrg(client, '', 'professionals')
  )
  assertEquals(res?.status, 500)
  assertEquals(calls, [])
})

import { assertEquals } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { requireModule } from './modules.ts'

function fakeClient(result: { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: Array<{ fn: string; args: unknown }> = []
  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args })
      return Promise.resolve(result)
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

Deno.test('requireModule: enabled module passes (null) and calls module_enabled', async () => {
  const { client, calls } = fakeClient({ data: true, error: null })
  assertEquals(await requireModule(client, 'professionals'), null)
  assertEquals(calls, [{ fn: 'module_enabled', args: { p_key: 'professionals' } }])
})

Deno.test('requireModule: disabled module gives 403', async () => {
  const { client } = fakeClient({ data: false, error: null })
  const res = await requireModule(client, 'professionals')
  assertEquals(res?.status, 403)
  assertEquals(await res?.json(), { error: 'Module disabled: professionals' })
})

Deno.test('requireModule: non-boolean result fails closed (403)', async () => {
  const { client } = fakeClient({ data: null, error: null })
  assertEquals((await requireModule(client, 'professionals'))?.status, 403)
})

Deno.test('requireModule: RPC error gives 500', async () => {
  const { client } = fakeClient({ data: null, error: { code: 'PGRST000', message: 'boom' } })
  assertEquals((await requireModule(client, 'professionals'))?.status, 500)
})

import { assertEquals, assertThrows } from '@std/assert'
import { fakeSupabase } from './fake-supabase.ts'

Deno.test('fakeSupabase: routes rpc calls to fixed results and handlers, in a call log', async () => {
  const { client, calls } = fakeSupabase({
    rpc: {
      fixed: { data: 1 },
      echo: (args) => ({ data: args.p_value }),
    },
  })
  const fixed = await client.rpc('fixed')
  const echo = await client.rpc('echo', { p_value: 'x' })
  assertEquals([fixed.data, fixed.error], [1, null])
  assertEquals([echo.data, echo.error], ['x', null])
  assertEquals(calls, [
    { fn: 'fixed', args: {} },
    { fn: 'echo', args: { p_value: 'x' } },
  ])
})

Deno.test('fakeSupabase: an unknown rpc answers like PostgREST (PGRST202)', async () => {
  const { client } = fakeSupabase({})
  const { data, error } = await client.rpc('missing')
  assertEquals(data, null)
  assertEquals(error?.code, 'PGRST202')
})

Deno.test('fakeSupabase: storage methods are routed by name, with the bucket logged', async () => {
  const { client, storageCalls } = fakeSupabase({
    storage: { remove: (bucket, paths) => ({ data: { bucket, paths } }) },
  })
  const { data, error } = await client.storage.from('documents').remove([
    'a',
    'b',
  ])
  assertEquals(data as unknown, { bucket: 'documents', paths: ['a', 'b'] })
  assertEquals(error, null)
  assertEquals(storageCalls, [{
    bucket: 'documents',
    method: 'remove',
    args: [['a', 'b']],
  }])
})

Deno.test('fakeSupabase: download(...).asStream() resolves to the same routed result', async () => {
  const stream = new Blob(['%PDF']).stream()
  const { client, storageCalls } = fakeSupabase({
    storage: { download: () => ({ data: stream }) },
  })
  const { data, error } = await client.storage.from('documents').download(
    'a.pdf',
  ).asStream()
  assertEquals(data, stream)
  assertEquals(error, null)
  assertEquals(storageCalls, [{
    bucket: 'documents',
    method: 'download',
    args: ['a.pdf'],
  }])
})

Deno.test('fakeSupabase: an unrouted storage method throws, naming it', () => {
  const { client, storageCalls } = fakeSupabase({
    storage: { remove: () => ({ data: null }) },
  })
  const bucket = client.storage.from('documents')
  assertThrows(
    () => bucket.createSignedUploadUrl('a.pdf'),
    Error,
    'fake: no storage.createSignedUploadUrl',
  )
  assertEquals(storageCalls, [])
})

Deno.test('fakeSupabase: auth.getUser answers the configured user, else a 401 error', async () => {
  const signedIn = fakeSupabase({ user: { id: 'u1' } })
  const ok = await signedIn.client.auth.getUser('tok')
  assertEquals([ok.data.user?.id, ok.error], ['u1', null])
  assertEquals(signedIn.authCalls, ['tok'])

  const anonymous = fakeSupabase({})
  const refused = await anonymous.client.auth.getUser('tok')
  assertEquals(refused.data.user, null)
  assertEquals(refused.error?.status, 401)
})

Deno.test('fakeSupabase: auth.admin methods are routed by name, in a call log', async () => {
  const { client, adminCalls } = fakeSupabase({
    admin: {
      createUser: (attrs) => ({
        data: { user: { id: 'u1', email: (attrs as { email: string }).email } },
      }),
      deleteUser: () => ({ error: { code: 'unexpected_failure' } }),
    },
  })
  const created = await client.auth.admin.createUser({ email: 'a@mana.test' })
  assertEquals(created.data.user?.id, 'u1')
  const deleted = await client.auth.admin.deleteUser('u1')
  assertEquals(deleted.error as unknown, { code: 'unexpected_failure' })
  assertEquals(adminCalls, [
    { method: 'createUser', args: [{ email: 'a@mana.test' }] },
    { method: 'deleteUser', args: ['u1'] },
  ])
  assertThrows(
    () => client.auth.admin.updateUserById('u1', { ban_duration: 'none' }),
    Error,
    'fake: no auth.admin.updateUserById',
  )
})

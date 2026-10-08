import { assert, assertEquals } from '@std/assert'
import { defaultDeps } from './deps.ts'
import { captureConsole, withEnv } from './testing/env.ts'

Deno.test('defaultDeps: env reads Deno.env at call time', async () => {
  const deps = defaultDeps()
  await withEnv({ DEPS_TEST_VALUE: 'a' }, () => {
    assertEquals(deps.env('DEPS_TEST_VALUE'), 'a')
  })
  assertEquals(deps.env('DEPS_TEST_VALUE'), undefined)
})

Deno.test('defaultDeps: now is the current time and fetch is the global fetch', () => {
  const deps = defaultDeps()
  assert(Math.abs(deps.now().getTime() - Date.now()) < 1_000)
  assertEquals(typeof deps.fetch, 'function')
})

Deno.test('defaultDeps: clients come from the auth factories (500 Response when unconfigured)', async () => {
  await withEnv({
    SUPABASE_URL: undefined,
    SUPABASE_ANON_KEY: undefined,
    SUPABASE_SERVICE_ROLE_KEY: undefined,
    SUPABASE_SECRET_KEYS: undefined,
  }, async () => {
    await captureConsole('error', () => {
      const deps = defaultDeps()
      assertEquals((deps.serviceClient() as Response).status, 500)
      assertEquals((deps.userClient('tok') as Response).status, 500)
    })
  })
  await withEnv({
    SUPABASE_URL: 'http://127.0.0.1:55321',
    SUPABASE_ANON_KEY: 'local-dev-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'local-dev-service',
  }, () => {
    const deps = defaultDeps()
    assertEquals(deps.serviceClient() instanceof Response, false)
    assertEquals(deps.userClient('tok') instanceof Response, false)
  })
})

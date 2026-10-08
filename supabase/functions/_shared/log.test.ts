import { assertEquals, assertFalse } from '@std/assert'
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { errorTag, logErrorCode } from './log.ts'
import { captureConsole } from './testing/env.ts'

Deno.test('errorTag: codes only, never a message, details or hint', () => {
  const postgrest = {
    code: '23505',
    message:
      'duplicate key value violates unique constraint "profiles_email_key"',
    details: 'Key (email)=(ana.gagnon@example.com) already exists.',
    hint: 'ana.gagnon@example.com',
  }
  assertEquals(errorTag(postgrest), 'code=23505')
  assertEquals(
    errorTag(
      new AuthApiError('User ana@example.com not found', 404, 'user_not_found'),
    ),
    'name=AuthApiError code=user_not_found status=404',
  )
  assertEquals(
    errorTag(new AuthRetryableFetchError('fetch failed', 0)),
    'name=AuthRetryableFetchError status=0',
  )
  assertEquals(
    errorTag(Object.assign(new Error('upstream'), { status: 502 })),
    'status=502',
  )
  assertEquals(errorTag(new TypeError('x@y.z')), 'name=TypeError')
  assertEquals(
    errorTag({ code: 'a b@c.d', status: '500' }),
    'unknown',
    'a code that is not a token is dropped',
  )
  assertEquals(errorTag('ana@example.com'), 'unknown')
  assertEquals(errorTag(null), 'unknown')
})

Deno.test('logErrorCode: one console.error line with the place, the event and the codes', async () => {
  const logged = await captureConsole('error', () => {
    logErrorCode('verifyAuth', 'get_my_access failed', {
      code: 'XX000',
      message: 'boom: ana@example.com',
    })
  })
  assertEquals(logged, [['[verifyAuth] get_my_access failed (code=XX000)']])
  assertFalse(JSON.stringify(logged).includes('@'))
})

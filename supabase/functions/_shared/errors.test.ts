import { assertEquals, assertInstanceOf } from '@std/assert'
import { FunctionError } from './errors.ts'

Deno.test('FunctionError: an Error carrying its ErrorCode', () => {
  const error = new FunctionError(
    'internal',
    'claim_webhook_event failed (XX000)',
  )
  assertInstanceOf(error, Error)
  assertEquals(error.name, 'FunctionError')
  assertEquals(error.code, 'internal')
  assertEquals(error.message, 'claim_webhook_event failed (XX000)')
})

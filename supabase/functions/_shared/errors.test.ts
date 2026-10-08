import { assertEquals, assertInstanceOf } from '@std/assert'
import { FunctionError, rpcErrorResponse } from './errors.ts'

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

Deno.test('rpcErrorResponse: P0001 passes its French message; 42501 → 403; 22023 → 400; others → 500', async () => {
  const body = async (res: Response) => [res.status, (await res.json()).error]
  assertEquals(
    await body(rpcErrorResponse({
      code: 'P0001',
      message: 'Cette personne a déjà un accès.',
    })),
    [400, {
      code: 'invalid_request',
      message: 'Cette personne a déjà un accès.',
    }],
  )
  assertEquals(
    await body(rpcErrorResponse({ code: '42501', message: 'Permission x' })),
    [403, { code: 'forbidden', message: 'Not allowed' }],
  )
  // 22023 messages may hold the argument: never passed through.
  assertEquals(
    await body(rpcErrorResponse({ code: '22023', message: 'Statut : x@y' })),
    [400, { code: 'invalid_request', message: 'Invalid request' }],
  )
  for (const error of [{ code: 'XX000', message: 'boom' }, { message: 'x' }]) {
    assertEquals(
      await body(rpcErrorResponse(error)),
      [500, { code: 'internal', message: 'Request failed' }],
    )
  }
})

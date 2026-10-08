import { assertEquals } from '@std/assert'
import { z } from 'zod'
import { readJson } from './http.ts'

const schema = z.object({ name: z.string().min(1) })

const post = (body: BodyInit, headers: HeadersInit = {}) =>
  new Request('https://fn.test/x', { method: 'POST', body, headers })

async function errorOf(res: unknown) {
  if (!(res instanceof Response)) throw new Error('expected a Response')
  return { status: res.status, ...(await res.json()).error }
}

Deno.test('readJson: returns the parsed value', async () => {
  assertEquals(await readJson(post('{"name":"Ana"}'), schema), { name: 'Ana' })
})

Deno.test('readJson: applies the schema output (unknown keys stripped)', async () => {
  assertEquals(await readJson(post('{"name":"Ana","x":1}'), schema), {
    name: 'Ana',
  })
})

Deno.test('readJson: a body of 65 537 bytes gives 413 invalid_request', async () => {
  const body = JSON.stringify({ name: 'a'.repeat(65_537 - 11) })
  assertEquals(new TextEncoder().encode(body).length, 65_537)
  assertEquals(await errorOf(await readJson(post(body), schema)), {
    status: 413,
    code: 'invalid_request',
    message: 'Request body too large',
  })
})

Deno.test('readJson: a body of exactly the limit is accepted', async () => {
  const body = JSON.stringify({ name: 'a'.repeat(65_536 - 11) })
  const value = await readJson(post(body), schema)
  assertEquals(value instanceof Response, false)
})

Deno.test('readJson: a declared Content-Length over the limit is refused before reading', async () => {
  const res = await readJson(
    post('{"name":"Ana"}', { 'Content-Length': '70000' }),
    schema,
  )
  assertEquals((await errorOf(res)).status, 413)
})

Deno.test('readJson: a streamed body over a custom limit gives 413', async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"name":"'))
      c.enqueue(new Uint8Array(20).fill(97))
      c.enqueue(new TextEncoder().encode('"}'))
      c.close()
    },
  })
  assertEquals(
    (await errorOf(await readJson(post(stream), schema, 16))).status,
    413,
  )
})

Deno.test('readJson: invalid JSON, invalid UTF-8 or no body gives 400 invalid_request', async () => {
  for (
    const req of [
      post('{"name":'),
      post(new Uint8Array([0x7b, 0xff, 0x7d])),
      new Request('https://fn.test/x', { method: 'POST' }),
    ]
  ) {
    assertEquals(await errorOf(await readJson(req, schema)), {
      status: 400,
      code: 'invalid_request',
      message: 'Invalid JSON body',
    })
  }
})

Deno.test('readJson: a schema error gives 400 without echoing the input', async () => {
  const res = await readJson(post('{"name":42,"secret":"s3cr3t"}'), schema)
  if (!(res instanceof Response)) throw new Error('expected a Response')
  const text = await res.text()
  assertEquals(res.status, 400)
  assertEquals(JSON.parse(text), {
    error: { code: 'invalid_request', message: 'Invalid request body' },
  })
  assertEquals(text.includes('42') || text.includes('s3cr3t'), false)
})

Deno.test('readJson: errors carry CORS headers for the request', async () => {
  const res = await readJson(post('nope'), schema)
  assertEquals(
    (res as Response).headers.get('Access-Control-Allow-Methods'),
    'GET, POST, OPTIONS',
  )
})

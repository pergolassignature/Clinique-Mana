import { assertEquals, assertRejects } from '@std/assert'
import { fakeFetch } from './fake-fetch.ts'

Deno.test('fakeFetch: routes by method and URL, and logs each call', async () => {
  const { fetch, calls } = fakeFetch({
    'POST https://api.example.test/send': () => new Response('ok'),
  })
  const res = await fetch('https://api.example.test/send?x=1', {
    method: 'POST',
    headers: { 'X-Test': '1' },
    body: '{"a":1}',
  })
  assertEquals(await res.text(), 'ok')
  assertEquals(calls.length, 1)
  assertEquals(calls[0].method, 'POST')
  assertEquals(calls[0].url, 'https://api.example.test/send?x=1')
  assertEquals(calls[0].headers.get('X-Test'), '1')
  assertEquals(calls[0].body, '{"a":1}')
})

Deno.test('fakeFetch: a list of responders is used in order; a throwing one is a network error', async () => {
  const { fetch } = fakeFetch({
    'GET https://api.example.test/': [
      () => {
        throw new TypeError('network down')
      },
      () => new Response(null, { status: 204 }),
    ],
  })
  await assertRejects(() => fetch('https://api.example.test/'), TypeError)
  assertEquals((await fetch('https://api.example.test/')).status, 204)
  await assertRejects(
    () => fetch('https://api.example.test/'),
    Error,
    'no response left',
  )
})

Deno.test('fakeFetch: an unknown route throws', async () => {
  const { fetch } = fakeFetch({})
  await assertRejects(
    () => fetch('https://nowhere.test/x'),
    Error,
    'no route for GET https://nowhere.test/x',
  )
})

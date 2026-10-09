import { assertEquals, assertRejects } from '@std/assert'
import {
  be16,
  be32,
  concatBytes,
  latin1,
  le16,
  le24,
  le32,
  readStreamCapped,
  toBase64,
} from './bytes.ts'

const stream = (chunks: number[][], onCancel?: () => void) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new Uint8Array(c))
      controller.close()
    },
    cancel: onCancel,
  })

Deno.test('readStreamCapped: the bytes in order; none → empty', async () => {
  assertEquals(
    await readStreamCapped(stream([[1, 2], [3]]), 3),
    new Uint8Array([1, 2, 3]),
  )
  assertEquals(await readStreamCapped(null, 3), new Uint8Array())
})

Deno.test('readStreamCapped: over the cap → null, the reader cancelled', async () => {
  let cancelled = false
  // An endless body: only the cap stops it.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array([1, 2]))
    },
    cancel() {
      cancelled = true
    },
  })
  assertEquals(await readStreamCapped(body, 3), null)
  assertEquals(cancelled, true)
})

Deno.test('readStreamCapped: a read error is thrown to the caller', async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error('reset'))
    },
  })
  await assertRejects(() => readStreamCapped(body, 10))
})

Deno.test('concatBytes and toBase64 (past one 32 KB chunk)', () => {
  assertEquals(
    concatBytes([new Uint8Array([1]), new Uint8Array(), new Uint8Array([2])]),
    new Uint8Array([1, 2]),
  )
  const big = new Uint8Array(0x8000 * 2 + 3).map((_, i) => i % 256)
  assertEquals(atob(toBase64(big)).length, big.length)
  assertEquals(toBase64(new TextEncoder().encode('Mana')), 'TWFuYQ==')
})

Deno.test('readers: endianness and Latin-1', () => {
  const b = new Uint8Array([0x01, 0x02, 0x03, 0xff, 0x41, 0x42])
  assertEquals(be16(b, 0), 0x0102)
  assertEquals(be32(b, 0), 0x010203ff)
  assertEquals(le16(b, 0), 0x0201)
  assertEquals(le24(b, 0), 0x030201)
  assertEquals(le32(b, 0), 0xff030201)
  assertEquals(latin1(b, 4, 6), 'AB')
})

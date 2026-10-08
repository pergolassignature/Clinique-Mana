import { assertEquals } from '@std/assert'
import { byteaHex } from './bytea.ts'

Deno.test('byteaHex: \\x then two lower-case hex digits per byte', () => {
  assertEquals(
    byteaHex(new Uint8Array([0x00, 0x0f, 0xab, 0xff])),
    '\\x000fabff',
  )
})

Deno.test('byteaHex: no bytes is a bare \\x', () => {
  assertEquals(byteaHex(new Uint8Array(0)), '\\x')
})

Deno.test('byteaHex: a 32-byte digest is \\x and 64 hex digits', () => {
  const bytes = Uint8Array.from({ length: 32 }, (_, i) => i * 8)
  const hex = byteaHex(bytes)
  assertEquals(hex.length, 66)
  assertEquals(hex.slice(0, 6), '\\x0008')
  assertEquals(hex.slice(-2), 'f8')
})

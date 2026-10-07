import { assert, assertFalse } from '@std/assert'
import { timingSafeEqual, timingSafeEqualBytes } from './timing-safe-equal.ts'

Deno.test('equal strings match', () =>
  assert(timingSafeEqual('secret', 'secret')))
Deno.test('different strings do not match', () =>
  assertFalse(timingSafeEqual('secret', 'secreT')))
Deno.test('different lengths do not match', () =>
  assertFalse(timingSafeEqual('secret', 'secret1')))
Deno.test('empty strings match; empty vs non-empty does not', () => {
  assert(timingSafeEqual('', ''))
  assertFalse(timingSafeEqual('', 'x'))
})
Deno.test('compares unicode via UTF-8 bytes', () => {
  assert(timingSafeEqual('café', 'café'))
  assertFalse(timingSafeEqual('café', 'cafe'))
})
Deno.test('byte buffers: any differing byte fails', () => {
  assert(
    timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])),
  )
  assertFalse(
    timingSafeEqualBytes(new Uint8Array([1, 2, 3]), new Uint8Array([9, 2, 3])),
  )
})

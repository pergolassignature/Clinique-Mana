import { assertEquals, assertNotStrictEquals } from '@std/assert'
import { fixedClock } from './fixed-clock.ts'

Deno.test('fixedClock: returns the fixed time, a new Date each call, and advances', () => {
  const clock = fixedClock('2026-10-08T12:00:00Z')
  const a = clock.now()
  assertEquals(a.toISOString(), '2026-10-08T12:00:00.000Z')
  assertNotStrictEquals(clock.now(), a)
  clock.advance(1_500)
  assertEquals(clock.now().toISOString(), '2026-10-08T12:00:01.500Z')
})

import { assertEquals } from '@std/assert'
import { lastDigits, normalizeE164 } from './phone.ts'

Deno.test('normalizeE164 reads North American and + numbers, refuses the rest', () => {
  assertEquals(normalizeE164('(514) 555-1234'), '+15145551234')
  assertEquals(normalizeE164('1 514 555 1234'), '+15145551234')
  assertEquals(normalizeE164('+1 514-555-1234'), '+15145551234')
  assertEquals(normalizeE164('+33 6 12 34 56 78'), '+33612345678')
  assertEquals(normalizeE164('555-1234'), null)
  assertEquals(normalizeE164('0514 555 1234'), null)
  assertEquals(normalizeE164('+1'), null)
  assertEquals(normalizeE164(''), null)
  assertEquals(normalizeE164(null), null)
  assertEquals(normalizeE164('api'), null)
})

Deno.test('lastDigits keeps the tail the PBX matches channels on', () => {
  assertEquals(lastDigits('+14185550199'), '4185550199')
  assertEquals(lastDigits('418 555-0199'), '4185550199')
  assertEquals(lastDigits('0199', 10), '0199')
  assertEquals(lastDigits(null), '')
})

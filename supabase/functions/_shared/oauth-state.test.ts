import { assert, assertEquals, assertFalse } from '@std/assert'
import { signState, STATE_TTL_S, verifyState } from './oauth-state.ts'

const SECRET = 'local-dev-internal-function-secret'
const ORG = '00000000-0000-4000-8000-000000000001'
const USER = '00000000-0000-4000-8000-0000000000a1'
const NOW = new Date('2026-10-12T15:00:00.000Z')
const input = {
  purpose: 'gmail_connect',
  orgId: ORG,
  userId: USER,
  data: { kind: 'shared' },
}

Deno.test('oauth-state: a signed state verifies with its purpose and carries its fields', async () => {
  const { state, nonce } = await signState(SECRET, input, NOW)
  assertEquals(state.split('.').length, 2)
  assertFalse(state.includes('+') || state.includes('/') || state.includes('='))
  const result = await verifyState(SECRET, state, 'gmail_connect', NOW)
  assert(result.ok)
  assertEquals(result.state.orgId, ORG)
  assertEquals(result.state.userId, USER)
  assertEquals(result.state.nonce, nonce)
  assertEquals(
    result.state.expiresAt,
    Math.floor(NOW.getTime() / 1000) + STATE_TTL_S,
  )
  assertEquals(result.state.data, { kind: 'shared' })
})

Deno.test('oauth-state: a changed payload, another key, a wrong purpose, an expiry and garbage are refused', async () => {
  const { state } = await signState(SECRET, input, NOW)
  const [payload, mac] = state.split('.')
  const forged = `${payload.slice(0, -2)}AA.${mac}`
  assertEquals(
    (await verifyState(SECRET, forged, 'gmail_connect', NOW)).ok,
    false,
  )
  const otherKey = await verifyState(
    'another-secret',
    state,
    'gmail_connect',
    NOW,
  )
  assertEquals(otherKey.ok ? null : otherKey.reason, 'bad_signature')
  const wrongPurpose = await verifyState(SECRET, state, 'zoom_connect', NOW)
  assertEquals(wrongPurpose.ok ? null : wrongPurpose.reason, 'wrong_purpose')
  const late = new Date(NOW.getTime() + (STATE_TTL_S + 1) * 1000)
  const expired = await verifyState(SECRET, state, 'gmail_connect', late)
  assertEquals(expired.ok ? null : expired.reason, 'expired')
  for (
    const garbage of [
      '',
      'abc',
      'abc.',
      '.abc',
      'a.b.c',
      `${payload}.short`,
      'x'.repeat(3000),
    ]
  ) {
    const result = await verifyState(SECRET, garbage, 'gmail_connect', NOW)
    assertEquals(result.ok, false, garbage.slice(0, 10))
  }
})

Deno.test('oauth-state: every state has its own nonce', async () => {
  const a = await signState(SECRET, input, NOW)
  const b = await signState(SECRET, input, NOW)
  assert(a.nonce !== b.nonce && a.state !== b.state)
})

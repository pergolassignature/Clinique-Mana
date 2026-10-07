/**
 * Constant-time comparison helpers for HMAC signatures and shared secrets.
 *
 * Use these instead of `===` (early-returns on first differing char and
 * leaks position-of-difference timing info) or ad-hoc per-function impls.
 */

/**
 * Compare two byte buffers in constant time relative to their content.
 *
 * Length mismatch returns false immediately — secret length is not the
 * secret. When lengths match, the loop runs to completion regardless of
 * where the first differing byte lives.
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i]
  }
  return diff === 0
}

/**
 * Compare two strings in constant time via their UTF-8 byte representation.
 * Convenience wrapper for hex/base64 HMAC signatures and bearer tokens.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  return timingSafeEqualBytes(enc.encode(a), enc.encode(b))
}

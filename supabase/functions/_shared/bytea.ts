/**
 * `bytea` values for PostgREST arguments (e.g. `p_token_hash`, `p_key_hash`).
 *
 * No top-level side effects.
 */

/**
 * `bytes` as a Postgres `bytea` hex-format literal: `\x` then two lower-case
 * hex digits per byte (`\x` alone for no bytes). PostgREST passes the string
 * through to the `bytea` cast unchanged.
 */
export function byteaHex(bytes: Uint8Array): string {
  return `\\x${
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }`
}

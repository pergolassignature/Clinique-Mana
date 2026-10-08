/**
 * Fixtures for the secure link function tests: `peek_secure_link` answers and
 * a counting `consume_rate_limit` route. Test-only: never deployed.
 */
import type { RpcRoute } from './fake-supabase.ts'
import { ORG_ID } from './email-fixtures.ts'

/** A well-formed token (43 base64url characters) and another one. */
export const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE'
export const OTHER_TOKEN = 'Zyxwvutsrqponmlkjihgfedcba9876543210-_ZYXWU'
export const LINK_ID = '00000000-0000-4000-8000-00000000011a'
export const INVITATION_ID = '00000000-0000-4000-8000-00000000021b'
export const INVITEE_EMAIL = 'nouvelle@mana.test'

/** A `valid` peek of a staff invitation link; fields in `over` replace. */
export function peekValid(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    state: 'valid',
    link_id: LINK_ID,
    org_id: ORG_ID,
    purpose: 'staff_invite',
    module_key: 'core',
    subject_type: 'staff_invitation',
    subject_id: INVITATION_ID,
    scope: {},
    expires_at: '2026-10-15T15:00:00+00:00',
    requires_session: false,
    creates_account: true,
    resolve_rpc: 'resolve_staff_invitation',
    accept_rpc: 'accept_staff_invitation',
    ...over,
  }
}

/** What `resolve_staff_invitation` returns for the fixture invitation. */
export function invitationDisplay(): Record<string, unknown> {
  return {
    clinic_name: 'Clinique MANA (local)',
    display_name: 'Nouvelle Personne',
    email: INVITEE_EMAIL,
    expires_at: '2026-10-15T15:00:00+00:00',
  }
}

/**
 * A `consume_rate_limit` route that counts hits per bucket and key hash, as
 * the fixed-window RPC does within one window: allowed while hits ≤ max.
 * `unavailable` buckets answer an RPC error (the limiter fails closed).
 */
export function countingLimiter(
  unavailable: string[] = [],
): { route: RpcRoute; hits: Map<string, number> } {
  const hits = new Map<string, number>()
  const route: RpcRoute = (args) => {
    const bucket = String(args.p_bucket)
    if (unavailable.includes(bucket)) {
      return { error: { code: 'XX000', message: 'fake: limiter down' } }
    }
    const key = `${bucket}|${args.p_key_hash}`
    const n = (hits.get(key) ?? 0) + 1
    hits.set(key, n)
    const allowed = n <= Number(args.p_max)
    return {
      data: [{ allowed, hits: n, retry_after_seconds: allowed ? 0 : 300 }],
    }
  }
  return { route, hits }
}

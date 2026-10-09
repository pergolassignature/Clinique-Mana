/**
 * Webhook plumbing shared by `resend-webhook` and `signing-webhook`: a response
 * helper without CORS (providers are not browsers), and typed wrappers of the
 * leased claim RPCs (`webhook_events`, Task 3.2; PS Hub
 * `claim_contract_webhook_event`).
 *
 * Flow: verify the signature with the secret of the org named by `?org=`,
 * then `claimEvent`;
 * `duplicate` → 200, `in_progress` → 409 (the provider retries); do the work;
 * then `completeEvent`, or `failEvent` with an error code and answer 500.
 * The payload passed to `claimEvent` is minimised by the caller (ids only).
 *
 * The wrappers need a service-role client. An RPC error throws a
 * `FunctionError('internal')` whose message holds the SQLSTATE only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { FunctionError } from './errors.ts'

/** A response for a webhook provider: JSON when `body` is given, `no-store`, no CORS. */
export function webhookResponse(status: number, body?: unknown): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  if (body === undefined) return new Response(null, { status, headers })
  headers['Content-Type'] = 'application/json'
  return new Response(JSON.stringify(body), { status, headers })
}

/** One provider event to claim. */
export interface ClaimInput {
  provider: 'resend' | 'documenso'
  /** Resend: the `svix-id`; Documenso: `<org_id>:<event>:<envelope_id>[:<version>]` (design §2.7, `documensoEventId`). */
  eventId: string
  /** The org whose secret verified the signature (`?org=`), never from the payload. */
  orgId: string
  eventType: string
  /** Minimised payload kept for a retry (ids only, no address). */
  payload: Record<string, unknown>
}

/** The claim outcome: only `claimed` carries the lease token. */
export type ClaimResult =
  | { status: 'claimed'; id: string; token: string }
  | { status: 'duplicate' }
  | { status: 'in_progress' }

function rpcFailure(fn: string, error: { code?: string } | null): never {
  throw new FunctionError(
    'internal',
    error ? `${fn} failed (${error.code ?? 'unknown'})` : `${fn}: bad result`,
  )
}

/**
 * Claims an event (a new event, a failed one, or a lapsed lease is `claimed`).
 * Throws `FunctionError` on an RPC error, including the 22023 the RPC raises
 * when the event id already belongs to another org.
 */
export async function claimEvent(
  client: SupabaseClient,
  input: ClaimInput,
): Promise<ClaimResult> {
  // Signature (*_core_rate_limits_webhook_events.sql):
  // claim_webhook_event(p_provider text, p_event_id text, p_org_id uuid,
  //   p_event_type text, p_payload jsonb, p_lease_seconds int default 300)
  //   returns table (status text, id uuid, claim_token uuid)
  // → PostgREST answers an array with one row. The lease keeps its default.
  const { data, error } = await client.rpc('claim_webhook_event', {
    p_provider: input.provider,
    p_event_id: input.eventId,
    p_org_id: input.orgId,
    p_event_type: input.eventType,
    p_payload: input.payload,
  })
  if (error) rpcFailure('claim_webhook_event', error)
  const row = Array.isArray(data) ? data[0] : null
  switch (row?.status) {
    case 'claimed':
      if (typeof row.id === 'string' && typeof row.claim_token === 'string') {
        return { status: 'claimed', id: row.id, token: row.claim_token }
      }
      break
    case 'duplicate':
    case 'in_progress':
      return { status: row.status }
  }
  return rpcFailure('claim_webhook_event', null)
}

async function booleanRpc(
  client: SupabaseClient,
  fn: string,
  args: Record<string, string>,
): Promise<boolean> {
  const { data, error } = await client.rpc(fn, args)
  if (error) rpcFailure(fn, error)
  if (typeof data !== 'boolean') rpcFailure(fn, null)
  return data
}

/**
 * Marks a claimed event completed (its payload is cleared). False when the
 * token no longer matches: the lease was taken over.
 */
export function completeEvent(
  client: SupabaseClient,
  id: string,
  token: string,
): Promise<boolean> {
  // SQL: complete_webhook_event(p_id uuid, p_claim_token uuid) returns boolean.
  return booleanRpc(client, 'complete_webhook_event', {
    p_id: id,
    p_claim_token: token,
  })
}

/**
 * Marks a claimed event failed, keeping its payload so the next delivery
 * retries. `code` must match `^[a-z0-9_]{1,64}$` (the RPC raises 22023).
 * False when the token no longer matches.
 */
export function failEvent(
  client: SupabaseClient,
  id: string,
  token: string,
  code: string,
): Promise<boolean> {
  // SQL: fail_webhook_event(p_id uuid, p_claim_token uuid, p_error text) returns boolean.
  return booleanRpc(client, 'fail_webhook_event', {
    p_id: id,
    p_claim_token: token,
    p_error: code,
  })
}

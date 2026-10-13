/**
 * The clinic's Stripe (Facturation FS): its secret key from Vault
 * (`get_org_secret`, service role), and the API client on the right origin.
 * Null when the clinic has not entered its key.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Deps } from '../deps.ts'
import { StripeApi, StripeError } from './client.ts'
import { SECRET_KEY, stripeApiOrigin } from './env.ts'

export async function clinicStripe(
  client: SupabaseClient,
  deps: Pick<Deps, 'env' | 'fetch'>,
  orgId: string,
): Promise<StripeApi | null> {
  const { data, error } = await client.rpc('get_org_secret', {
    p_org_id: orgId,
    p_key: SECRET_KEY,
  })
  if (error) throw new StripeError('secret_unavailable', 0)
  if (
    typeof data !== 'string' ||
    !/^(sk|rk)_(test|live)_[A-Za-z0-9_]{4,255}$/.test(data)
  ) return null
  return new StripeApi(deps.fetch, stripeApiOrigin(deps.env), data)
}

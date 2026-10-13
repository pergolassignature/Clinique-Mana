/**
 * One QuickBooks read pass (« Synchroniser », after a connection): the
 * company's name, its chart of accounts (then Christine's defaults on the
 * empty or suggested rows of the map, in SQL), its customers (all of them,
 * page by page, in chunks of 500), the customers QuickBooks no longer has
 * removed, then the matching with Clients' rules (`match_qbo_customers`,
 * 300 at a time until done or the soft deadline: the next pass continues).
 *
 * Nothing is written to QuickBooks here (FQ-4). Nothing logs a name, an
 * email or a phone: the counts only.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { QboClient, type QboCustomer, QboError } from './client.ts'
import {
  type CredentialsContext,
  type OAuthApp,
  qboCredentials,
  ReconnectNeeded,
} from './credentials.ts'

const CUSTOMER_CHUNK = 500
const MATCH_BATCH = 300

export interface SyncContext extends CredentialsContext {
  /** Stop starting new steps after this instant (ms); the next pass continues the matching. */
  softDeadline: number
  sleep?: (ms: number) => Promise<void>
}

export interface SyncResult {
  status: 'ok' | 'partial' | 'failed'
  accounts: number
  customers: number
  matched: number
  /** Matching left for the next pass. */
  pending: boolean
  errorCode?: string
}

/** The fields the matching reads, in a stable order. */
export function customerRow(c: QboCustomer) {
  const phones = [
    c.PrimaryPhone?.FreeFormNumber,
    c.Mobile?.FreeFormNumber,
    c.AlternatePhone?.FreeFormNumber,
  ]
    .map((p) => p?.trim() ?? '')
    .filter((p) => p !== '')
  return {
    id: c.Id,
    display_name: c.DisplayName?.trim() ?? '',
    given_name: c.GivenName?.trim() || null,
    family_name: c.FamilyName?.trim() || null,
    company_name: c.CompanyName?.trim() || null,
    email: c.PrimaryEmailAddr?.Address?.trim().toLowerCase() || null,
    phones: [...new Set(phones)].slice(0, 4),
    is_job: c.Job === true,
    parent_id: c.ParentRef?.value ?? null,
    active: c.Active !== false,
  }
}

/** A short hash of what the matching reads: a changed customer is matched again. */
export async function rowHash(
  row: ReturnType<typeof customerRow>,
): Promise<string> {
  const { active: _active, ...matched } = row
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(matched)),
  )
  return [...new Uint8Array(digest)].slice(0, 16).map((b) =>
    b.toString(16).padStart(2, '0')
  ).join('')
}

/** A call with the current token; one forced refresh on a 401, then once more. */
async function withFreshToken<T>(
  ctx: SyncContext,
  app: OAuthApp,
  run: (qbo: QboClient) => Promise<T>,
): Promise<T> {
  let credentials = await qboCredentials(ctx, app)
  const client = () =>
    new QboClient({
      fetch: ctx.fetch,
      origin: ctx.origins.api(credentials.environment),
      realmId: credentials.realmId,
      accessToken: credentials.accessToken,
      signal: ctx.signal,
      sleep: ctx.sleep,
    })
  try {
    return await run(client())
  } catch (error) {
    if (!(error instanceof QboError) || error.code !== 'unauthorized') {
      throw error
    }
    credentials = await qboCredentials(ctx, app, { force: true })
    try {
      return await run(client())
    } catch (again) {
      if (again instanceof QboError && again.code === 'unauthorized') {
        await ctx.client.rpc('set_qbo_connection_status', {
          p_org_id: ctx.orgId,
          p_status: 'needs_reconnect',
          p_reason: 'unauthorized',
        })
        throw new ReconnectNeeded('unauthorized')
      }
      throw again
    }
  }
}

async function rpc(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = await client.rpc(fn, args)
  if (result.error) throw new QboError('provider_error')
  return result.data
}

/** The matching, until done or the deadline; answers how many and whether some are left. */
export async function matchCustomers(
  ctx: SyncContext,
): Promise<{ matched: number; pending: boolean }> {
  let matched = 0
  for (;;) {
    if (Date.now() > ctx.softDeadline) return { matched, pending: true }
    const n = Number(
      await rpc(ctx.client, 'match_qbo_customers', {
        p_org_id: ctx.orgId,
        p_limit: MATCH_BATCH,
      }),
    )
    matched += n
    if (n < MATCH_BATCH) return { matched, pending: false }
  }
}

/** One pass; see the module comment. `ReconnectNeeded` and `NotConnected` are thrown. */
export async function runQboSync(
  ctx: SyncContext,
  app: OAuthApp,
): Promise<SyncResult> {
  const started = ctx.now().toISOString()
  const result: SyncResult = {
    status: 'ok',
    accounts: 0,
    customers: 0,
    matched: 0,
    pending: false,
  }
  let companyName: string | null = null
  let accountsDone = false
  let customersDone = false
  try {
    const read = await withFreshToken(ctx, app, async (qbo) => ({
      company: await qbo.companyName(),
      accounts: await qbo.accounts(),
      customers: await qbo.customers(),
    }))
    companyName = read.company
    await rpc(ctx.client, 'replace_qbo_accounts', {
      p_org_id: ctx.orgId,
      p_accounts: read.accounts.map((a) => ({
        id: a.Id,
        name: a.Name.slice(0, 200),
        fully_qualified_name: a.FullyQualifiedName?.slice(0, 400) ?? null,
        acct_num: a.AcctNum?.slice(0, 32) ?? null,
        account_type: a.AccountType.slice(0, 64),
        account_sub_type: a.AccountSubType?.slice(0, 64) ?? null,
        classification: a.Classification?.slice(0, 32) ?? null,
        active: a.Active !== false,
      })).slice(0, 2_000),
    })
    result.accounts = read.accounts.length
    accountsDone = true

    const rows = await Promise.all(read.customers.map(async (c) => {
      const row = customerRow(c)
      return { ...row, hash: await rowHash(row) }
    }))
    for (let i = 0; i < rows.length; i += CUSTOMER_CHUNK) {
      await rpc(ctx.client, 'upsert_qbo_customers', {
        p_org_id: ctx.orgId,
        p_sync_started_at: started,
        p_customers: rows.slice(i, i + CUSTOMER_CHUNK),
      })
    }
    await rpc(ctx.client, 'prune_qbo_customers', {
      p_org_id: ctx.orgId,
      p_sync_started_at: started,
    })
    result.customers = rows.length
    customersDone = true

    const matching = await matchCustomers(ctx)
    result.matched = matching.matched
    result.pending = matching.pending
    if (matching.pending) result.status = 'partial'
  } catch (error) {
    if (error instanceof ReconnectNeeded) throw error
    if ((error as Error).name === 'NotConnected') throw error
    result.status = 'failed'
    result.errorCode = error instanceof QboError
      ? `qbo_${error.code}`
      : 'sync_failed'
  }
  await ctx.client.rpc('finish_qbo_sync', {
    p_org_id: ctx.orgId,
    p_status: result.status,
    p_error_code: result.errorCode ??
      (result.pending ? 'matching_pending' : null),
    p_company_name: companyName,
    p_accounts_synced: accountsDone,
    p_customers_synced: customersDone,
  })
  return result
}

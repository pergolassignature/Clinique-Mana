import { z } from 'zod'
import { supabase } from '@/core/supabase/client'
import { invokeFunction } from '@/core/supabase/functions'

/*
 * QuickBooks (FQ, part 1): the connection (`qbo-connect`, `qbo-callback`, `qbo-sync`), the settings
 * screen's read (`get_qbo_settings`: no token ever), the accounts map (`set_qbo_account_map`) and
 * the customers' mapping report (`qbo_customer_match_counts`, `list_qbo_customer_matches`,
 * `decide_qbo_customer_match`). Everything needs billing.settings; the database checks it.
 */

export const QBO_ENVIRONMENTS = ['production', 'sandbox'] as const
export type QboEnvironment = (typeof QBO_ENVIRONMENTS)[number]

/** The map's rows, in the screen's order (an expense row per profession title follows). */
export const ACCOUNT_MAP_KEYS = [
  'revenue.services',
  'revenue.file_opening',
  'deposit.interac',
  'deposit.stripe',
  'deposit.qbo_payments_card',
  'deposit.bank_transfer',
  'deposit.cheque',
] as const
export type AccountMapKey = (typeof ACCOUNT_MAP_KEYS)[number] | 'expense'

const connectionSchema = z.object({
  id: z.string(),
  realm_id: z.string(),
  environment: z.enum(QBO_ENVIRONMENTS),
  company_name: z.string().nullable(),
  status: z.enum(['connected', 'needs_reconnect', 'disconnected']),
  status_reason: z.string().nullable(),
  connected_at: z.string(),
  connected_by_name: z.string().nullable(),
  disconnected_at: z.string().nullable(),
  refresh_token_expires_at: z.string().nullable(),
  last_sync_at: z.string().nullable(),
  last_sync_status: z.enum(['ok', 'partial', 'failed']).nullable(),
  last_error_code: z.string().nullable(),
  accounts_synced_at: z.string().nullable(),
  customers_synced_at: z.string().nullable(),
})
export type QboConnection = z.infer<typeof connectionSchema>

const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  fully_qualified_name: z.string().nullable(),
  acct_num: z.string().nullable(),
  account_type: z.string(),
})
export type QboAccount = z.infer<typeof accountSchema>

const mapRowSchema = z.object({
  key: z.string(),
  profession_title_id: z.string().nullable(),
  profession_title_name: z.string().nullable(),
  account_id: z.string().nullable(),
  suggested: z.boolean(),
})
export type AccountMapRow = z.infer<typeof mapRowSchema>

const settingsSchema = z.object({
  connection: connectionSchema.nullable(),
  accounts: z.array(accountSchema),
  map: z.array(mapRowSchema),
})
export type QboSettings = z.infer<typeof settingsSchema>

/** The connection (no token), the active accounts and the map. */
export async function fetchQboSettings(): Promise<QboSettings> {
  const { data, error } = await supabase.rpc('get_qbo_settings')
  if (error) throw error
  return settingsSchema.parse(data)
}

/** Which account types a map row accepts (the database checks the same: `qbo_account_fits`). */
export function accountFits(key: string, accountType: string): boolean {
  if (key.startsWith('revenue.')) return accountType === 'Income' || accountType === 'Other Income'
  if (key.startsWith('deposit.')) return accountType === 'Bank' || accountType === 'Other Current Asset'
  if (key === 'expense') return ['Expense', 'Other Expense', 'Cost of Goods Sold'].includes(accountType)
  return false
}

/** One map row's account (null: none chosen). A person's choice is never replaced by a suggestion. */
export async function saveAccountMapRow(key: string, professionTitleId: string | null, accountId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_qbo_account_map', {
    p_key: key,
    ...(professionTitleId ? { p_profession_title_id: professionTitleId } : {}),
    ...(accountId ? { p_account_id: accountId } : {}),
  })
  if (error) throw error
}

const startSchema = z.object({ url: z.url({ protocol: /^https?$/ }) })

/** « Connecter QuickBooks »: Intuit's consent page for the clinic's application (signed state, 10 minutes). */
export async function startQboConnect(environment: QboEnvironment): Promise<string> {
  return startSchema.parse(await invokeFunction('qbo-connect', { action: 'start', environment })).url
}

const callbackSchema = z.object({ connection_id: z.string(), company_name: z.string().nullable() })
export type ConnectedCompany = z.infer<typeof callbackSchema>

/** The return from Intuit: the code, the state and the company it handed the browser, posted with the session. */
export async function finishQboConnect(code: string, state: string, realmId: string): Promise<ConnectedCompany> {
  return callbackSchema.parse(await invokeFunction('qbo-callback', { code, state, realm_id: realmId }))
}

const syncSchema = z.object({
  status: z.enum(['ok', 'partial', 'failed']),
  accounts: z.number(),
  customers: z.number(),
  matched: z.number(),
  pending: z.boolean(),
})
export type QboSyncResult = z.infer<typeof syncSchema>

/** « Synchroniser »: the accounts and the customers read again, then matched. Nothing written to QuickBooks. */
export async function syncQbo(): Promise<QboSyncResult> {
  return syncSchema.parse(await invokeFunction('qbo-sync', {}))
}

const disconnectSchema = z.object({ ok: z.literal(true), revoked: z.boolean() })

/** « Déconnecter »: the grant revoked at Intuit, the tokens deleted; the mapping stays. */
export async function disconnectQbo(): Promise<{ revoked: boolean }> {
  const { revoked } = disconnectSchema.parse(await invokeFunction('qbo-connect', { action: 'disconnect' }))
  return { revoked }
}

export const MATCH_STATUSES = ['to_decide', 'linked', 'no_match', 'ignored'] as const
export type MatchStatus = (typeof MATCH_STATUSES)[number]

const countsSchema = z.array(z.object({ status: z.enum(MATCH_STATUSES), customers: z.number() }))

/** How many QuickBooks customers per status. */
export async function fetchMatchCounts(): Promise<Record<MatchStatus, number>> {
  const { data, error } = await supabase.rpc('qbo_customer_match_counts')
  if (error) throw error
  const counts = { to_decide: 0, linked: 0, no_match: 0, ignored: 0 }
  for (const row of countsSchema.parse(data)) counts[row.status] = row.customers
  return counts
}

const clientRefSchema = z.object({
  id: z.string(),
  client_number: z.number(),
  display_name: z.string(),
  email: z.string().nullable().optional(),
  is_archived: z.boolean(),
})
export type ClientRef = z.infer<typeof clientRefSchema>

const matchSchema = z.object({
  qbo_id: z.string(),
  display_name: z.string(),
  email: z.string().nullable(),
  phones: z.array(z.string()),
  active: z.boolean(),
  level: z.enum(['high', 'medium', 'none']),
  reasons: z.array(z.string()),
  status: z.enum(MATCH_STATUSES),
  source: z.enum(['auto', 'manual']),
  decided_at: z.string().nullable(),
  client: clientRefSchema.nullable(),
  candidates: z.array(clientRefSchema),
})
export type CustomerMatch = z.infer<typeof matchSchema>

/** Customers per page of the report. */
export const MATCH_PAGE_SIZE = 50

/** One page of the report, by name. */
export async function listMatches(status: MatchStatus, search: string, page: number): Promise<CustomerMatch[]> {
  const { data, error } = await supabase.rpc('list_qbo_customer_matches', {
    p_status: status,
    ...(search.trim() && { p_search: search.trim() }),
    p_offset: page * MATCH_PAGE_SIZE,
    p_limit: MATCH_PAGE_SIZE,
  })
  if (error) throw error
  return z.array(matchSchema).parse(data)
}

const searchResultSchema = z.object({
  id: z.string(),
  client_number: z.number(),
  first_name: z.string(),
  last_name: z.string(),
  email: z.string().nullable(),
  is_archived: z.boolean(),
})
export type ClientSearchResult = z.infer<typeof searchResultSchema>

/** Clients' published search (`search_clients`, clients.view): another file to link a customer to. */
export async function searchClients(query: string): Promise<ClientSearchResult[]> {
  const { data, error } = await supabase.rpc('search_clients', { p_query: query.trim(), p_limit: 8 })
  if (error) throw error
  return z.array(searchResultSchema).parse(data)
}

export type MatchDecision = { decision: 'link'; clientId: string } | { decision: 'ignore' | 'reset' }

/** A person's decision on one customer; answers its new status. */
export async function decideMatch(qboId: string, decision: MatchDecision): Promise<MatchStatus> {
  const { data, error } = await supabase.rpc('decide_qbo_customer_match', {
    p_qbo_id: qboId,
    p_decision: decision.decision,
    ...(decision.decision === 'link' && { p_client_id: decision.clientId }),
  })
  if (error) throw error
  return z.enum(MATCH_STATUSES).parse(data)
}

import { i18nAuditLabels } from '@/core/audit/module-labels'

/**
 * The module's audited tables, in the order of the Journal d'audit's « Section » filter: the
 * client, what hangs off the file, then the clinic's lists. `src/app/audit-labels.test.ts`
 * checks it against the migrations' audit triggers.
 */
export const CLIENTS_AUDITED_TABLES = [
  'clients',
  'client_notes',
  'client_relations',
  'client_insurances',
  'client_payers',
  'client_tag_links',
  'client_professional_links',
  'client_merges',
  'client_consents',
  'client_consent_requests',
  'client_consent_request_signers',
  'client_tags',
  'referral_sources',
  'client_consent_types',
  'client_consent_version_clauses',
  'client_consent_rules',
  'client_consent_settings',
  'client_consent_campaigns',
  'client_consent_campaign_items',
] as const

/** The audit source of the referral sources seed (`private.seed_clients_reference`). */
export const CLIENTS_SEED_SOURCE = 'seed:clients_reference'
/** The consents' seed and the signature's trigger (C5a). */
export const CLIENTS_CONSENT_SOURCES = ['seed:clients_consents', 'trigger:clients_consent_signature'] as const

const MONEY_COLUMNS = new Set(['session_amount_cents', 'max_amount_cents'])
const money = new Intl.NumberFormat('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Amounts in the module's words; stored codes (sex, language, relation types, kinds) are in the i18n `values`. */
function clientsValue(_table: string, column: string, value: unknown): string | undefined {
  if (typeof value === 'number' && MONEY_COLUMNS.has(column)) return `${money.format(value / 100)}\u00A0$`
  return undefined
}

/**
 * What the module tells the Journal d'audit (`clientsManifest.audit`, loaded with the journal):
 * its tables' and columns' French names (`modules.clients.audit.tables` / `.fields`), its
 * values, and its own source (the referral sources seed). Personal values arrive redacted.
 */
export const clientsAuditLabels = i18nAuditLabels({
  prefix: 'modules.clients.audit',
  tables: CLIENTS_AUDITED_TABLES,
  value: clientsValue,
  sources: [CLIENTS_SEED_SOURCE, ...CLIENTS_CONSENT_SOURCES],
})

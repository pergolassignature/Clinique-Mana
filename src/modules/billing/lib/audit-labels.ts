import { i18nAuditLabels, lookupAuditText } from '@/core/audit/module-labels'

/**
 * The module's audited tables, in the order of the Journal d'audit's « Section » filter. Each
 * batch adds its own (FQ: the QuickBooks connection, its tokens, the accounts map, the customers'
 * matches and links). `src/app/audit-labels.test.ts` checks it against the migrations' triggers.
 */
export const BILLING_AUDITED_TABLES = [
  'qbo_connections',
  'qbo_connection_tokens',
  'qbo_account_map',
  'qbo_customer_matches',
  'qbo_links',
] as const

/** What the module tells the Journal d'audit (`billingManifest.audit`, loaded with the journal). */
export const billingAuditLabels = i18nAuditLabels({
  prefix: 'modules.billing.audit',
  tables: BILLING_AUDITED_TABLES,
  // The map's keys hold a dot (`deposit.interac`), which a code lookup refuses: their labels are
  // stored with « _ » (`values.qbo_account_map.map_key.deposit_interac`).
  value: (table, column, stored) =>
    table === 'qbo_account_map' && column === 'map_key' && typeof stored === 'string' && /^[a-z_]{1,30}(\.[a-z_]{1,30})?$/.test(stored)
      ? lookupAuditText(`modules.billing.audit.values.qbo_account_map.map_key.${stored.replace('.', '_')}`)
      : undefined,
})

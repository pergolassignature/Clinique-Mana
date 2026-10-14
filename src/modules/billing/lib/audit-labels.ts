import { i18nAuditLabels, lookupAuditText } from '@/core/audit/module-labels'

/**
 * The module's audited tables, in the order of the Journal d'audit's « Section » filter: the
 * invoices and their lines, the credit notes, the payers, then the clinic's lists (F1), then the
 * QuickBooks connection, its tokens, the accounts map, the customers' matches and links (FQ).
 * `src/app/audit-labels.test.ts` checks it against the migrations' audit triggers.
 */
export const BILLING_AUDITED_TABLES = [
  'invoices',
  'invoice_lines',
  'credit_notes',
  'payments',
  'receipts',
  'statements',
  'special_agreements',
  'billing_queue_items',
  'billing_deliveries',
  // F3: reminders, cancellation fees, refunds.
  'billing_dunning_runs',
  'cancellation_fee_decisions',
  'refunds',
  'billing_payer_defaults',
  'invoice_sequences',
  'payment_modes',
  'billing_settings',
  // FPay: the payroll.
  'payout_periods',
  'payout_lines',
  'professional_invoices',
  'payout_service_rules',
  // FS: Stripe and Interac.
  'stripe_customers',
  'stripe_charges',
  'interac_notices',
  // FP: third-party payers (IVAC, PAE).
  'payer_organisations',
  'billing_payer_rates',
  'client_payer_organisations',
  'qbo_connections',
  'qbo_connection_tokens',
  'qbo_account_map',
  'qbo_customer_matches',
  'qbo_links',
  'qbo_organisation_links',
  'qbo_vendor_links',
  // BI-27: « Bill annulé dans QuickBooks ».
  'qbo_bill_clearances',
] as const

/** The audit source of the per-clinic seed (`private.seed_billing_reference`). */
export const BILLING_SEED_SOURCE = 'seed:billing_reference'

/**
 * What the module tells the Journal d'audit (`billingManifest.audit`, loaded with the journal):
 * its tables' and columns' French names (`modules.billing.audit`), its values, and its seed's
 * source. Notes, line descriptions and credit-note reasons arrive redacted.
 */
export const billingAuditLabels = i18nAuditLabels({
  prefix: 'modules.billing.audit',
  tables: BILLING_AUDITED_TABLES,
  sources: [BILLING_SEED_SOURCE],
  // The map's keys hold a dot (`deposit.interac`), which a code lookup refuses: their labels are
  // stored with « _ » (`values.qbo_account_map.map_key.deposit_interac`).
  value: (table, column, stored) =>
    table === 'qbo_account_map' && column === 'map_key' && typeof stored === 'string' && /^[a-z_]{1,30}(\.[a-z_]{1,40})?$/.test(stored)
      ? lookupAuditText(`modules.billing.audit.values.qbo_account_map.map_key.${stored.replace('.', '_')}`)
      : undefined,
})

import { i18nAuditLabels } from '@/core/audit/module-labels'

/**
 * The module's audited tables, in the order of the Journal d'audit's « Section » filter: the
 * invoices and their lines, the credit notes, the payers, then the clinic's lists.
 * `src/app/audit-labels.test.ts` checks it against the migrations' audit triggers.
 */
export const BILLING_AUDITED_TABLES = [
  'invoices',
  'invoice_lines',
  'credit_notes',
  'billing_payer_defaults',
  'invoice_sequences',
  'payment_modes',
  // FPay: the payroll.
  'payout_periods',
  'payout_lines',
  'professional_invoices',
  'payout_service_rules',
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
})

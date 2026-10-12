import { i18nAuditLabels } from '@/core/audit/module-labels'
import { SEED_SOURCE } from './constants'
import { formatCents, formatPercent } from './format'

/**
 * The module's audited tables, in the order of the Journal d'audit's « Section » filter: the
 * catalogue, then what hangs off it. `src/app/audit-labels.test.ts` checks it against the
 * migrations' audit triggers.
 */
export const SERVICES_AUDITED_TABLES = ['service_families', 'services', 'service_titles', 'service_rate_variants', 'billing_policies'] as const

const MONEY_COLUMNS = new Set(['fixed_price_cents', 'amount_cents'])
const PERCENT_COLUMNS = new Set(['percent', 'first_fee_percent', 'next_fee_percent'])

/** Amounts and percents in the module's words; stored codes (kinds, sources, modes) are in the i18n `values`. */
function servicesValue(_table: string, column: string, value: unknown): string | undefined {
  if (typeof value === 'number' && MONEY_COLUMNS.has(column)) return formatCents(value)
  if (typeof value === 'number' && PERCENT_COLUMNS.has(column)) return formatPercent(value)
  if (column === 'grid_duration' && typeof value === 'number') return `${value}\u00A0min`
  return undefined
}

/**
 * What the module tells the Journal d'audit (`servicesManifest.audit`, loaded with the journal):
 * its tables' and columns' French names (`modules.services.audit.tables` / `.fields`), its
 * values, and its own source (the catalogue seed).
 */
export const servicesAuditLabels = i18nAuditLabels({
  prefix: 'modules.services.audit',
  tables: SERVICES_AUDITED_TABLES,
  value: servicesValue,
  sources: [SEED_SOURCE],
})

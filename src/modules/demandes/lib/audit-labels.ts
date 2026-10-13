import { i18nAuditLabels } from '@/core/audit/module-labels'

/**
 * The module's audited tables, in the order of the Journal d'audit's « Section » filter: the
 * request and what hangs off it, then the waiting list. `src/app/audit-labels.test.ts` checks it
 * against the migrations' audit triggers.
 */
export const DEMANDES_AUDITED_TABLES = [
  'demandes',
  'demande_notes',
  'demande_participants',
  'demande_motifs',
  'demande_events',
  'demande_tasks',
  'demande_propositions',
  'waitlist_entries',
  'waitlist_contacts',
  'waitlist_offers',
] as const

/**
 * What the module tells the Journal d'audit (`demandesManifest.audit`, loaded with the journal):
 * its tables' and columns' French names (`modules.demandes.audit.tables` / `.fields`) and its
 * stored codes (`.values`: states, channels, reasons…). Personal values arrive redacted.
 */
export const demandesAuditLabels = i18nAuditLabels({
  prefix: 'modules.demandes.audit',
  tables: DEMANDES_AUDITED_TABLES,
})

import { i18nAuditLabels } from '@/core/audit/module-labels'

/**
 * The module's audited tables, in the order of the Journal d'audit's « Section » filter. Each
 * batch adds its own (CM1: the mailboxes and their tokens, the thread links; CM3: the sends, the templates; SM: the SMS consents).
 * `src/app/audit-labels.test.ts` checks it against the migrations' audit triggers.
 */
export const COMMUNICATIONS_AUDITED_TABLES = [
  'mail_connections',
  'mail_connection_tokens',
  'mail_thread_links',
  // CM3: what was sent from the app (ids and counts), and each person's templates.
  'mail_sends',
  'mail_templates',
  'sms_consents',
] as const

/**
 * What the module tells the Journal d'audit (`communicationsManifest.audit`, loaded with the
 * journal): its tables' and columns' French names (`modules.communications.audit.tables` /
 * `.fields`) and its stored codes (`.values`).
 */
export const communicationsAuditLabels = i18nAuditLabels({
  prefix: 'modules.communications.audit',
  tables: COMMUNICATIONS_AUDITED_TABLES,
})

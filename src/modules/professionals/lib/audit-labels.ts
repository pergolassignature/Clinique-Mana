import { t } from '@/i18n'
import { i18nAuditLabels } from '@/core/audit/module-labels'
import { formatPhone } from '@/shared/lib/format'
import { DECISIONS, DURATIONS, type Decision, type Duration } from '../api/compensation'
import { durationLabel, formatCents, formatPercent, formatSessions, monthLabel } from './compensation'
import {
  AVAILABILITY_PERIODS,
  GENDERS,
  MOTIF_CATEGORY_ICONS,
  PROFESSIONAL_STATUSES,
  SUBMISSION_SECTIONS,
  type AvailabilityPeriod,
  type Gender,
  type MotifCategoryIcon,
  type ProfessionalStatus,
  type SubmissionSection,
} from './constants'
import { genderLabel, listLabel, motifIconLabel, periodsLabel, statusLabel } from './display'

/**
 * The module's audited tables, in the order of the Journal d'audit's « Section » filter: the
 * records and what hangs off them, then the settings, then the reference lists.
 * `src/app/audit-labels.test.ts` checks it against the migrations' audit triggers.
 */
export const PROFESSIONALS_AUDITED_TABLES = [
  'professionals',
  'professional_professions',
  'professional_payer_numbers',
  'professional_public_profiles',
  'professional_matching_profiles',
  'professional_matching_notes',
  'professional_motifs',
  'professional_clienteles',
  'professional_languages',
  'professional_private',
  'professional_invitation_deliveries',
  'professional_submissions',
  'professional_submission_private',
  'professional_documents',
  'professional_consents',
  'professional_contract_snapshots',
  'professional_session_counts',
  'professional_retention',
  'professional_client_agreements',
  'document_types',
  'consent_versions',
  'retention_grids',
  'retention_grid_tiers',
  'retention_grid_prices',
  'compensation_rates',
  'professional_orders',
  'profession_categories',
  'profession_titles',
  'clienteles',
  'motif_categories',
  'motifs',
  'languages',
  'deactivation_reasons',
] as const

const isOneOf = <T extends string | number>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value)

const PERCENT_COLUMNS = new Set(['retention_pct', 'suggested_pct'])
const MONEY_COLUMNS = new Set(['client_price_cents', 'professional_amount_cents'])
const SESSION_COLUMNS = new Set(['sessions_total', 'adjustment'])
const PHONE_COLUMNS = new Set(['personal_phone', 'public_phone'])

/**
 * The values the module's own helpers read (the same words as its screens): a professional's
 * status and gender, a motif category's icon, a month of sessions, durations, rates, amounts,
 * session counts, availability periods, the sections an update asks for. Stored codes with a fixed
 * French word (document and questionnaire statuses, expiry rules…) are in the i18n
 * (`modules.professionals.audit.values`); everything else is core's (dates by column name).
 */
function professionalsValue(table: string, column: string, value: unknown): string | undefined {
  if (table === 'professionals' && column === 'status' && isOneOf<ProfessionalStatus>(PROFESSIONAL_STATUSES, value)) return statusLabel(value)
  if (table === 'professionals' && column === 'gender' && isOneOf<Gender>(GENDERS, value)) return genderLabel(value)
  if (table === 'motif_categories' && column === 'icon' && isOneOf<MotifCategoryIcon>(MOTIF_CATEGORY_ICONS, value)) return motifIconLabel(value)
  if (table === 'professional_session_counts' && column === 'month' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return monthLabel(value)
  }
  if (column === 'decision' && isOneOf<Decision>(DECISIONS, value)) return t(`modules.professionals.compensation.decisions.${value}`)
  if (column === 'duration' && isOneOf<Duration>(DURATIONS, value)) return durationLabel(value)
  if (typeof value === 'number' && PERCENT_COLUMNS.has(column)) return formatPercent(value)
  if (typeof value === 'number' && MONEY_COLUMNS.has(column)) return formatCents(value)
  if (typeof value === 'number' && SESSION_COLUMNS.has(column)) return formatSessions(value)
  if (typeof value === 'string' && PHONE_COLUMNS.has(column)) return formatPhone(value)
  if (column === 'availability_periods' && Array.isArray(value) && value.every((p) => isOneOf<AvailabilityPeriod>(AVAILABILITY_PERIODS, p))) {
    return value.length > 0 ? periodsLabel(value) : undefined
  }
  if (column === 'requested_sections' && Array.isArray(value) && value.length > 0 && value.every((s) => isOneOf<SubmissionSection>(SUBMISSION_SECTIONS, s))) {
    return listLabel(value.map((section) => t(`modules.professionals.onboarding.sections.${section}`)))
  }
  return undefined
}

/**
 * What the module tells the Journal d'audit (`professionalsManifest.audit`, loaded with the
 * journal): its tables' and columns' French names (`modules.professionals.audit.tables` /
 * `.fields`), its values, and its own source (`import` → « Importation »). The Historique tab
 * names the columns with it too.
 */
export const professionalsAuditLabels = i18nAuditLabels({
  prefix: 'modules.professionals.audit',
  tables: PROFESSIONALS_AUDITED_TABLES,
  value: professionalsValue,
  sources: ['import'],
})

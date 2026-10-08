import { t } from '@/i18n'
import type { ReadinessItemKey, ReadinessMissing, ReadinessWarning, RecordTab } from './constants'
import type { ProfessionalRecord } from '../api/parse'
import { activationLabel, statusActions } from './status-actions'

/** « Profil de jumelage complet ». */
export function readinessItemLabel(key: ReadinessItemKey): string {
  return t(`modules.professionals.readiness.items.${key}`)
}

/** What is missing, as the end of « Il manque … »: « un titre professionnel », « le numéro de permis »… */
export function missingLabel(key: ReadinessMissing): string {
  return t(`modules.professionals.readiness.missing.${key}`)
}

export function warningLabel(key: ReadinessWarning): string {
  return t(`modules.professionals.readiness.warnings.${key}`)
}

/** The tab where each gap is fixed (Aperçu links each missing part there). */
export const MISSING_TAB: Readonly<Record<ReadinessMissing, RecordTab>> = {
  profession: 'identite',
  licence: 'identite',
  regulated_title: 'identite',
  language: 'jumelage',
  clientele: 'jumelage',
  motif: 'jumelage',
}

/** Who may fix the gaps of each tab. */
const TAB_PERMISSION: Partial<Record<RecordTab, string>> = { identite: 'professionals.manage', jumelage: 'professionals.matching' }

/** The button of « Prochaine action »: a link to the tab that fixes a gap, or the activation dialog. */
export type NextActionButton = { kind: 'tab'; label: string; tab: RecordTab } | { kind: 'activate'; label: string }

export interface NextAction {
  message: string
  /** At most one small outline button, only when the user may do what it leads to. */
  action: NextActionButton | null
}

/**
 * Aperçu « Prochaine action » (4a rules): the first gap's tab (identity gaps come first in the
 * RPC's order); a complete file not yet active is ready, with « Activer » (« Réactiver » once
 * inactive) opening the same dialog as the header's teal action (P4-74, 4a.14); an active one needs
 * nothing.
 */
export function nextAction(record: Pick<ProfessionalRecord, 'professional' | 'readiness'>, can: (permission: string) => boolean): NextAction {
  const N = 'modules.professionals.readiness.nextAction'
  if (record.readiness.complete) {
    if (record.professional.status === 'active') return { message: t(`${N}.nothingToDo`), action: null }
    const kind = statusActions(record, can).activate
    return {
      message: t(record.professional.status === 'inactive' ? `${N}.readyToReactivate` : `${N}.readyToActivate`),
      action: kind ? { kind: 'activate', label: activationLabel(kind) } : null,
    }
  }
  // Matching gaps come first; items without `missing` keys (account, questionnaire: 4b.1) have no tab
  // to fix them yet (4b.3 adds the invitation actions).
  const firstGap = record.readiness.items.flatMap((i) => (i.done ? [] : i.missing))[0]
  if (!firstGap) return { message: t(`${N}.awaitingOnboarding`), action: null }
  const tab = MISSING_TAB[firstGap]
  const permission = TAB_PERMISSION[tab]
  return {
    message: t(tab === 'identite' ? `${N}.completeIdentity` : `${N}.completeMatching`),
    action: permission && can(permission) ? { kind: 'tab', label: t(`${N}.complete`), tab } : null,
  }
}

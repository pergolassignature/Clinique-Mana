import { t } from '@/i18n'
import type { ReadinessItemKey, ReadinessMissing, ReadinessWarning, RecordTab } from './constants'
import type { ProfessionalRecord } from '../api/parse'

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

export interface NextAction {
  message: string
  /** At most one small outline button, to the tab that fixes the first gap (when the user may edit it). */
  action: { label: string; tab: RecordTab } | null
}

/**
 * Aperçu « Prochaine action » (4a rules): the first gap's tab (identity gaps come first in the
 * RPC's order); a complete file not yet active is ready (the header holds the teal « Activer »);
 * an active one needs nothing.
 */
export function nextAction(record: Pick<ProfessionalRecord, 'professional' | 'readiness'>, can: (permission: string) => boolean): NextAction {
  if (record.readiness.complete) {
    const key = record.professional.status === 'active' ? 'nothingToDo' : 'readyToActivate'
    return { message: t(`modules.professionals.readiness.nextAction.${key}`), action: null }
  }
  const firstGap = record.readiness.items.find((i) => !i.done)?.missing[0]
  const tab = firstGap ? MISSING_TAB[firstGap] : 'jumelage'
  const permission = TAB_PERMISSION[tab]
  return {
    message: t(tab === 'identite' ? 'modules.professionals.readiness.nextAction.completeIdentity' : 'modules.professionals.readiness.nextAction.completeMatching'),
    action: permission && can(permission) ? { label: t('modules.professionals.readiness.nextAction.complete'), tab } : null,
  }
}

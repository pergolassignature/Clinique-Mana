import { t } from '@/i18n'
import type { ProfessionalRecord } from '../api/parse'

type StatusSubject = Pick<ProfessionalRecord, 'professional' | 'readiness'>
type Can = (permission: string) => boolean

/** « Activer », or « Réactiver » for an inactive file (P4-110). */
type ActivationKind = 'activate' | 'reactivate'

/** The status actions the record offers (4a.14), as `activate_professional` and `deactivate_professional` allow them. */
interface StatusActions {
  /** The header's teal action; null when the file is active, or incomplete without the override. */
  activate: ActivationKind | null
  /** « Désactiver » in the « … » menu: any status but inactive. */
  deactivate: boolean
}

/** « Activer » / « Réactiver »: the header's button and Aperçu's « Prochaine action ». */
export function activationLabel(kind: ActivationKind): string {
  return t(`modules.professionals.record.actions.${kind}`)
}

export function statusActions({ professional, readiness }: StatusSubject, can: Can): StatusActions {
  if (!can('professionals.manage')) return { activate: null, deactivate: false }
  const inactive = professional.status === 'inactive'
  const mayActivate = professional.status !== 'active' && (readiness.complete || can('professionals.activate_override'))
  return { activate: mayActivate ? (inactive ? 'reactivate' : 'activate') : null, deactivate: !inactive }
}

/**
 * What the activation dialog asks: a plain confirmation for a complete file, the override reason
 * for an incomplete one (`professionals.activate_override`), nothing it can confirm when the file
 * became incomplete for someone without the override, or once the professional is active (the
 * record changed while the dialog was open).
 */
export type ActivationMode = 'confirm' | 'override' | 'blocked' | 'done'

export function activationMode({ professional, readiness }: StatusSubject, can: Can): ActivationMode {
  if (professional.status === 'active') return 'done'
  if (readiness.complete) return 'confirm'
  return can('professionals.activate_override') ? 'override' : 'blocked'
}

import { t } from '@/i18n'
import type { ReadinessItemKey, ReadinessMissing, ReadinessWarning, RecordTab } from './constants'
import type { Onboarding, ProfessionalRecord } from '../api/parse'
import { invitationState, onboardingActionLabel, onboardingActions, shortDate, type InviteAction } from './onboarding'
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
  // « Documents » (Task 4c.3): no button until the tab is built (TAB_PERMISSION has no entry).
  photo: 'documents',
  insurance: 'documents',
  insurance_expired: 'documents',
  image_consent: 'documents',
  other_documents: 'documents',
}

type Can = (permission: string) => boolean

/** Who may fix the gaps of each tab. */
const TAB_PERMISSION: Partial<Record<RecordTab, string>> = { identite: 'professionals.manage', jumelage: 'professionals.matching' }

/**
 * Where a submission is reviewed (the review's entry point): « Questionnaire et mises à jour » in
 * « Documents », which Task 4b.5 adds; it sets this to `'documents'` with the tab. Until then
 * « Prochaine action » says the profile waits for its review, without a button.
 */
export const REVIEW_TAB: RecordTab | null = null

/**
 * The button of « Prochaine action »: a link to a tab (the one that fixes a gap, or the review's),
 * the activation dialog, or the invitation's confirmation (`InvitationDialog`).
 */
export type NextActionButton =
  | { kind: 'tab'; label: string; tab: RecordTab }
  | { kind: 'activate'; label: string }
  | { kind: 'invite'; label: string; action: InviteAction }

export interface NextAction {
  message: string
  /** At most one small outline button, only when the user may do what it leads to. */
  action: NextActionButton | null
}

type NextActionSubject = Pick<ProfessionalRecord, 'professional' | 'readiness'>

const N = 'modules.professionals.readiness.nextAction'

/**
 * Aperçu « Prochaine action » (4a rules, then Task 4b.3): one plain sentence of where the file
 * stands and at most one button that does exactly what it says. In order:
 * 1. a submission waiting for review (« Réviser le profil » to REVIEW_TAB, `professionals.review`);
 * 2. an inactive file: reactivate it, or complete it first;
 * 3. no account and the link expired: « Envoyer un nouveau lien » (`professionals.invite`);
 * 4. the first gap of the matching profile (its tab): staff complete it, then invite (or the
 *    invitation left with the creation);
 * 5. no account and no live link: « Envoyer l'invitation » (never invited, the link revoked, or
 *    used by an account that has since been removed: each says which);
 * 6. waiting for the professional: the link sent (or opened), or the questionnaire being filled in;
 * 7. a complete file: « Activer » (the header's dialog, P4-74), or nothing to do once active.
 */
export function nextAction(record: NextActionSubject, onboarding: Onboarding | null, can: Can, now: number): NextAction {
  const { professional, readiness } = record
  const firstName = professional.firstName
  const submission = onboarding?.submission ?? null
  if (submission?.status === 'submitted') {
    const date = submission.submittedAt ? shortDate(submission.submittedAt, now) : null
    const key = submission.kind === 'onboarding' ? 'reviewOnboarding' : 'reviewUpdate'
    return {
      message: date ? t(`${N}.${key}`, { firstName, date }) : t(`${N}.${key}Undated`, { firstName }),
      action: REVIEW_TAB && can('professionals.review') ? { kind: 'tab', label: t(`${N}.review`), tab: REVIEW_TAB } : null,
    }
  }
  if (professional.status === 'inactive') return readinessStep(record, can) ?? activationStep(record, can)

  const { invite } = onboardingActions(professional, onboarding, can, now)
  const inviteButton: NextActionButton | null = invite ? { kind: 'invite', label: onboardingActionLabel(invite), action: invite } : null
  const invitation = onboarding?.invitation ?? null
  // As of `now`: a link past its expiry reads expired before the next refetch.
  const state = invitationState(invitation, now)
  const noAccount = professional.profileId === null
  if (noAccount && invitation && state === 'expired') {
    return { message: t(`${N}.invitationExpired`, { date: shortDate(invitation.expiresAt, now) }), action: inviteButton }
  }
  const gap = readinessStep(record, can)
  if (gap) return gap
  if (noAccount && invitation && state === 'revoked') return { message: t(`${N}.invitationRevoked`, { firstName }), action: inviteButton }
  if (noAccount && invitation && state === 'used') {
    return { message: t(`${N}.invitationUsedNoAccount`, { firstName, date: shortDate(invitation.usedAt ?? invitation.sentAt, now) }), action: inviteButton }
  }
  if (noAccount && !invitation) return { message: t(`${N}.notInvited`, { firstName }), action: inviteButton }
  if (noAccount && invitation) {
    return {
      message:
        state === 'opened' && invitation.openedAt
          ? t(`${N}.invitationOpened`, { firstName, date: shortDate(invitation.openedAt, now) })
          : t(`${N}.invitationSent`, { firstName, date: shortDate(invitation.sentAt, now) }),
      action: null,
    }
  }
  if (submission?.status === 'draft') {
    return { message: t(submission.kind === 'onboarding' ? `${N}.questionnaireInProgress` : `${N}.updateInProgress`, { firstName }), action: null }
  }
  if (!readiness.complete) return { message: t(`${N}.awaitingQuestionnaire`, { firstName }), action: null }
  return activationStep(record, can)
}

/** The first gap's tab (identity gaps come first in the RPC's order); null without one. */
function readinessStep({ readiness }: NextActionSubject, can: Can): NextAction | null {
  // Items without `missing` keys (account, questionnaire) are the onboarding's: not a tab's gap.
  const firstGap = readiness.complete ? undefined : readiness.items.flatMap((i) => (i.done ? [] : i.missing))[0]
  if (!firstGap) return null
  const tab = MISSING_TAB[firstGap]
  const permission = TAB_PERMISSION[tab]
  return {
    message: t(tab === 'identite' ? `${N}.completeIdentity` : tab === 'documents' ? `${N}.completeDocuments` : `${N}.completeMatching`),
    action: permission && can(permission) ? { kind: 'tab', label: t(`${N}.complete`), tab } : null,
  }
}

/**
 * A complete file not yet active is ready, with « Activer » (« Réactiver » once inactive) opening
 * the header's dialog (P4-74, 4a.14); an active one needs nothing. An inactive file that is not
 * complete (an imported one, P4-179) can still be reactivated with the override.
 */
function activationStep(record: NextActionSubject, can: Can): NextAction {
  const { status } = record.professional
  if (status === 'active') return { message: t(`${N}.nothingToDo`), action: null }
  const kind = statusActions(record, can).activate
  const message = status === 'inactive' ? (record.readiness.complete ? `${N}.readyToReactivate` : `${N}.reactivateIncomplete`) : `${N}.readyToActivate`
  return { message: t(message), action: kind ? { kind: 'activate', label: activationLabel(kind) } : null }
}

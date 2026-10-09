import { t } from '@/i18n'
import type { ReadinessItemKey, ReadinessMissing, ReadinessWarning, RecordTab } from './constants'
import type { Onboarding, ProfessionalRecord } from '../api/parse'
import {
  emailFailureReason,
  invitationEmail,
  invitationState,
  onboardingActionLabel,
  onboardingActions,
  shortDate,
  unknownEmailOutcome,
  type InviteAction,
} from './onboarding'
import { activationLabel, statusActions } from './status-actions'

/** « Profil de jumelage complet ». */
export function readinessItemLabel(key: ReadinessItemKey, done = true): string {
  return done ? t(`modules.professionals.readiness.items.${key}`) : t(`modules.professionals.readiness.pending.${key}`)
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
  // « Documents » (Task 4c.3): « Compléter » for whoever uploads (`professionals.manage`).
  photo: 'documents',
  insurance: 'documents',
  insurance_expired: 'documents',
  image_consent: 'documents',
  other_documents: 'documents',
}

type Can = (permission: string) => boolean

/** Who may fix the gaps of each tab. */
const TAB_PERMISSION: Partial<Record<RecordTab, string>> = { identite: 'professionals.manage', jumelage: 'professionals.matching', documents: 'professionals.manage' }

/**
 * Where a submission is reviewed (the review's entry point, Task 4b.5): « Questionnaire et mises à
 * jour » in « Documents ». « Prochaine action »'s « Réviser le profil » and « À surveiller »'s
 * review flags link there; so does the in-app notice (`/professionnels/:id/documents`, P4-271).
 */
export const REVIEW_TAB: RecordTab = 'documents'

/** Where the service contract is sent and followed (the card atop Documents, Task 4d.3). */
export const CONTRACT_TAB: RecordTab = 'documents'

/**
 * Where the service contract stands, for « Prochaine action » (`contractProgress`, lib/contract.ts):
 * nothing out (to send, again or for the first time), or out and waiting for a signer. Null when the
 * card is not loaded or in between (a send running): the sentence then names both.
 */
export type ContractProgress = { kind: 'to_send' } | { kind: 'awaiting'; name: string }

/**
 * The button of « Prochaine action »: a link to a tab (the one that fixes a gap, or the review's),
 * the activation dialog, the invitation's confirmation (`InvitationDialog`), or « Copier le lien
 * d'invitation » (`CopyInvitationLinkDialog`, P4-491).
 */
export type NextActionButton =
  | { kind: 'tab'; label: string; tab: RecordTab }
  | { kind: 'activate'; label: string }
  | { kind: 'invite'; label: string; action: InviteAction }
  | { kind: 'copyLink'; label: string }

export interface NextAction {
  message: string
  /** At most one small outline button, only when the user may do what it leads to. */
  action: NextActionButton | null
  /** A second button, beside it: « Copier le lien d'invitation » when the email did not leave. */
  secondary?: NextActionButton | null
}

type NextActionSubject = Pick<ProfessionalRecord, 'professional' | 'readiness'>

const N = 'modules.professionals.readiness.nextAction'

/**
 * Aperçu « Prochaine action » (4a rules, then Task 4b.3): one plain sentence of where the file
 * stands and at most one button that does exactly what it says. In order:
 * 1. a submission waiting for review (« Réviser le profil » to REVIEW_TAB, `professionals.review`,
 *    never on the viewer's own file: P4-304, the database refuses it; `viewerId` is the signed-in
 *    user's id);
 * 2. an inactive file: reactivate it, or complete it first;
 * 3. no account and the link expired: « Envoyer un nouveau lien » (`professionals.invite`); or its
 *    email did not leave: why, « Renvoyer l'invitation » and « Copier le lien d'invitation » (P4-490);
 * 4. the first gap of the matching profile (its tab): staff complete it, then invite (or the
 *    invitation left with the creation);
 * 5. no account and no live link: « Envoyer l'invitation » (never invited, the link revoked, or
 *    used by an account that has since been removed: each says which);
 * 6. waiting for the professional: the link sent (or opened, or copied), or the questionnaire being
 *    filled in; an unknown outcome says « Résultat inconnu » (with « Copier le lien »), a copied
 *    link « Lien d'invitation copié le … », a send still running « en cours d'envoi »;
 * 7. only the service contract left (4d.3): « Contrat de service à envoyer » or « En attente de la
 *    signature de … » (`contract`), else both in one sentence; « Voir le contrat » (Documents);
 * 8. a complete file: « Activer » (the header's dialog, P4-74), or nothing to do once active.
 */
export function nextAction(
  record: NextActionSubject,
  onboarding: Onboarding | null,
  can: Can,
  now: number,
  viewerId: string | null = null,
  contract: ContractProgress | null = null,
): NextAction {
  const { professional, readiness } = record
  const firstName = professional.firstName
  const submission = onboarding?.submission ?? null
  if (submission?.status === 'submitted') {
    const date = submission.submittedAt ? shortDate(submission.submittedAt, now) : null
    // The reviewer's own file: another authorised person reviews it (P4-304), so no button.
    const own = viewerId !== null && professional.profileId === viewerId
    const kind = submission.kind === 'onboarding' ? 'Onboarding' : 'Update'
    const key = own ? (`reviewOwn${kind}` as const) : (`review${kind}` as const)
    return {
      message: date ? t(`${N}.${key}`, { firstName, date }) : t(`${N}.${key}Undated`, { firstName }),
      action: can('professionals.review') && !own ? { kind: 'tab', label: t(`${N}.review`), tab: REVIEW_TAB } : null,
    }
  }
  if (professional.status === 'inactive') return readinessStep(record, can) ?? activationStep(record, can)

  const { invite, copyLink } = onboardingActions(professional, onboarding, can, now)
  const inviteButton: NextActionButton | null = invite ? { kind: 'invite', label: onboardingActionLabel(invite), action: invite } : null
  const invitation = onboarding?.invitation ?? null
  // As of `now`: a link past its expiry reads expired before the next refetch.
  const state = invitationState(invitation, now)
  const noAccount = professional.profileId === null
  if (noAccount && invitation && state === 'expired') {
    return { message: t(`${N}.invitationExpired`, { date: shortDate(invitation.expiresAt, now) }), action: inviteButton }
  }
  const copyButton: NextActionButton | null = copyLink ? { kind: 'copyLink', label: onboardingActionLabel('copyLink') } : null
  // An email that did not leave comes before the gaps too, as an expired link: the professional
  // is waiting for a link she never received (P4-490).
  const email = noAccount && invitation && state === 'sent' ? invitationEmail(invitation, now) : null
  if (invitation && email?.kind === 'failed') {
    return {
      message: `${t(`${N}.invitationNotSent`, { firstName, date: shortDate(invitation.sentAt, now) })} ${emailFailureReason(email.reason)}`,
      action: inviteButton,
      secondary: copyButton,
    }
  }
  // The checklist's order: the file's own gaps (identity, matching) before the invitation; the
  // documents after the onboarding, which collects the photo and the insurance itself.
  const gap = readinessStep(record, can, (key) => key !== 'documents')
  if (gap) return gap
  if (noAccount && invitation && state === 'revoked') return { message: t(`${N}.invitationRevoked`, { firstName }), action: inviteButton }
  if (noAccount && invitation && state === 'used') {
    return { message: t(`${N}.invitationUsedNoAccount`, { firstName, date: shortDate(invitation.usedAt ?? invitation.sentAt, now) }), action: inviteButton }
  }
  if (noAccount && !invitation) return { message: t(`${N}.notInvited`, { firstName }), action: inviteButton }
  if (noAccount && invitation) {
    const date = shortDate(invitation.sentAt, now)
    if (state === 'opened' && invitation.openedAt) {
      return { message: t(`${N}.invitationOpened`, { firstName, date: shortDate(invitation.openedAt, now) }), action: null }
    }
    switch (invitationEmail(invitation, now).kind) {
      case 'copied':
        return { message: t(`${N}.invitationCopied`, { firstName, date }), action: null }
      case 'pending':
        return { message: t(`${N}.invitationSending`, { firstName }), action: null }
      case 'unknown': {
        const { label, detail } = unknownEmailOutcome()
        return { message: t(`${N}.invitationUnknown`, { firstName, date, outcome: label, detail }), action: null, secondary: copyButton }
      }
      case 'failed':
      case 'sent':
        return { message: t(`${N}.invitationSent`, { firstName, date }), action: null }
    }
  }
  if (submission?.status === 'draft') {
    return { message: t(submission.kind === 'onboarding' ? `${N}.questionnaireInProgress` : `${N}.updateInProgress`, { firstName }), action: null }
  }
  const documentsGap = readinessStep(record, can)
  if (documentsGap) return documentsGap
  const contractItem = readiness.items.find((i) => i.key === 'contract_signed')
  if (!readiness.complete && contractItem && !contractItem.done && readiness.items.every((i) => i === contractItem || i.done)) {
    const message =
      contract?.kind === 'awaiting'
        ? t(`${N}.contractAwaiting`, { name: contract.name })
        : contract?.kind === 'to_send'
          ? t(`${N}.contractToSend`, { firstName })
          : t(`${N}.contractToSign`, { firstName })
    return { message, action: { kind: 'tab', label: t(`${N}.openContract`), tab: CONTRACT_TAB } }
  }
  if (!readiness.complete) return { message: t(`${N}.awaitingQuestionnaire`, { firstName }), action: null }
  return activationStep(record, can)
}

/** The first gap's tab among the items `include` keeps (identity gaps come first in the RPC's order); null without one. */
function readinessStep({ readiness }: NextActionSubject, can: Can, include: (key: ReadinessItemKey) => boolean = () => true): NextAction | null {
  // Items without `missing` keys (account, questionnaire) are the onboarding's: not a tab's gap.
  const firstGap = readiness.complete ? undefined : readiness.items.flatMap((i) => (i.done || !include(i.key) ? [] : i.missing))[0]
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

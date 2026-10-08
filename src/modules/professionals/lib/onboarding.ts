import { differenceInCalendarDays, parseISO } from 'date-fns'
import { t } from '@/i18n'
import { formatInClinicTimezone, getClinicDateString } from '@/shared/lib/timezone'
import type { InvitationInfo, Onboarding, Professional } from '../api/parse'
import type { DisplayStatus, ProfessionalStatus, SubmissionSection } from './constants'

/**
 * The onboarding as staff read it (Task 4b.3): the displayed status (P4-43), what the invitation
 * menu offers, and the plain sentences of Aperçu (« Invitation envoyée le 8 oct. · expire le
 * 15 oct. »). Every date is a timestamp shown in the clinic's timezone.
 */

const O = 'modules.professionals.onboarding'

type Can = (permission: string) => boolean

/**
 * P4-43: a stored `in_review` reads « À réviser » while a submission waits for review, and « En
 * préparation » once the onboarding questionnaire is approved with nothing waiting (the file is
 * not active yet). Any other status reads as stored.
 */
export function displayStatus(status: ProfessionalStatus, onboarding: Onboarding | null): DisplayStatus {
  if (status !== 'in_review') return status
  return onboarding?.onboardingApproved && onboarding.submission?.status !== 'submitted' ? 'preparing' : 'in_review'
}

/** The link can still be used: sent or opened, not expired, revoked nor used. */
export function isLiveInvitation(invitation: InvitationInfo | null | undefined): boolean {
  return invitation?.state === 'sent' || invitation?.state === 'opened'
}

/**
 * The three ways to email a link (P4-260: each issues a new link and revokes the previous one):
 * a first invitation (or after a revocation), again while the link works, or after it expired.
 */
export const INVITE_ACTIONS = ['send', 'resend', 'new_link'] as const
export type InviteAction = (typeof INVITE_ACTIONS)[number]

export interface OnboardingActions {
  /** « Envoyer l'invitation », « Renvoyer l'invitation » or « Envoyer un nouveau lien ». */
  invite: InviteAction | null
  /** « Révoquer l'invitation »: only while the link works. */
  revoke: boolean
  /** « Demander une mise à jour »: an account, and no submission open (one at a time). */
  requestUpdate: boolean
}

const NO_ACTIONS: OnboardingActions = { invite: null, revoke: false, requestUpdate: false }

/**
 * What the record offers, as `professionals-invite` allows it (`professionals.invite`): nothing
 * for an inactive file (P4-303); without an account, an invitation (any other status, P4-171);
 * with one, an update request while no submission is open.
 */
export function onboardingActions(professional: Pick<Professional, 'status' | 'profileId'>, onboarding: Onboarding | null, can: Can): OnboardingActions {
  if (!can('professionals.invite') || professional.status === 'inactive') return NO_ACTIONS
  if (professional.profileId !== null) return { invite: null, revoke: false, requestUpdate: !onboarding?.submission }
  const invitation = onboarding?.invitation ?? null
  if (isLiveInvitation(invitation)) return { invite: 'resend', revoke: true, requestUpdate: false }
  return { invite: invitation?.state === 'expired' ? 'new_link' : 'send', revoke: false, requestUpdate: false }
}

/** The menu's and the buttons' words: they say exactly what the click does. */
export function onboardingActionLabel(action: InviteAction | 'revoke' | 'requestUpdate'): string {
  return t(`${O}.actions.${action}`)
}

/** « Renseignements personnels », « Fiscalité et banque »… */
export function sectionLabel(section: SubmissionSection): string {
  return t(`${O}.sections.${section}`)
}

/**
 * « 8 oct. » within the clinic's current year, « 8 oct. 2025 » otherwise (an invitation's dates
 * are recent; the year only when it would be ambiguous).
 */
export function shortDate(iso: string, now: number): string {
  const sameYear = getClinicDateString(iso).slice(0, 4) === getClinicDateString(new Date(now)).slice(0, 4)
  return formatInClinicTimezone(iso, sameYear ? 'd MMM' : 'd MMM yyyy')
}

/** Whole clinic days from `iso` to `now` (0 on the same clinic day). */
export function clinicDaysSince(iso: string, now: number): number {
  return differenceInCalendarDays(parseISO(getClinicDateString(new Date(now))), parseISO(getClinicDateString(iso)))
}

/**
 * The invitation in one line (A2.5), for Aperçu: « Invitation envoyée le 8 oct. · ouverte le 9 oct.
 * · expire le 15 oct. », « Lien expiré le 15 oct. — envoyez un nouveau lien. », « Invitation
 * acceptée le 9 oct. », « Invitation révoquée : le lien ne fonctionne plus. », or « Aucune
 * invitation envoyée. ».
 */
export function invitationLine(invitation: InvitationInfo | null, now: number): string {
  if (!invitation) return t(`${O}.invitation.none`)
  const d = (iso: string) => shortDate(iso, now)
  switch (invitation.state) {
    case 'sent':
      return t(`${O}.invitation.sent`, { sent: d(invitation.sentAt), expires: d(invitation.expiresAt) })
    case 'opened':
      return t(`${O}.invitation.opened`, {
        sent: d(invitation.sentAt),
        opened: d(invitation.openedAt ?? invitation.sentAt),
        expires: d(invitation.expiresAt),
      })
    case 'expired':
      return t(`${O}.invitation.expired`, { expires: d(invitation.expiresAt) })
    case 'used':
      return t(`${O}.invitation.used`, { used: d(invitation.usedAt ?? invitation.sentAt) })
    case 'revoked':
      return t(`${O}.invitation.revoked`)
  }
}

/**
 * « Questionnaire approuvé »'s line while it is not: sent and waiting for review, being filled
 * in, or not yet opened (no account). Null once approved.
 */
export function questionnaireLine(professional: Pick<Professional, 'profileId'>, onboarding: Onboarding | null, now: number): string | null {
  if (onboarding?.onboardingApproved) return null
  const submission = onboarding?.submission?.kind === 'onboarding' ? onboarding.submission : null
  if (submission?.status === 'submitted') {
    return submission.submittedAt
      ? t(`${O}.questionnaire.submitted`, { date: shortDate(submission.submittedAt, now) })
      : t(`${O}.questionnaire.submittedUndated`)
  }
  if (professional.profileId === null) return t(`${O}.questionnaire.afterInvitation`)
  return submission ? t(`${O}.questionnaire.inProgress`) : t(`${O}.questionnaire.none`)
}

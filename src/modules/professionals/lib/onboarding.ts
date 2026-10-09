import { differenceInCalendarDays, parseISO } from 'date-fns'
import { t } from '@/i18n'
import { emailStatusLabel } from '@/core/email/status'
import { formatInClinicTimezone, getClinicDateString } from '@/shared/lib/timezone'
import type { InvitationInfo, Onboarding, Professional } from '../api/parse'
import type { DisplayStatus, InvitationState, ProfessionalStatus, SubmissionSection } from './constants'

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

/**
 * The link's state at `now`: one read as `sent` or `opened` whose expiry has passed is `expired`
 * (the server says so on its next read), so a page left open reads « Lien expiré » without a
 * refetch. Null without a link.
 */
export function invitationState(invitation: InvitationInfo | null | undefined, now: number = Date.now()): InvitationState | null {
  if (!invitation) return null
  if ((invitation.state === 'sent' || invitation.state === 'opened') && Date.parse(invitation.expiresAt) <= now) return 'expired'
  return invitation.state
}

/** The link can still be used at `now`: sent or opened, not expired, revoked nor used. */
export function isLiveInvitation(invitation: InvitationInfo | null | undefined, now: number = Date.now()): boolean {
  const state = invitationState(invitation, now)
  return state === 'sent' || state === 'opened'
}

/**
 * Where the link's handover stands (P4-490), so that no screen says « envoyée » for an email that
 * did not leave:
 * - `copied`: « Copier le lien d'invitation » (P4-491), no email expected;
 * - `sent`: its invitation (or reminder) email was queued, sent or delivered (« complained »: it
 *   arrived);
 * - `unknown`: `failed` + `provider_unavailable`, « Résultat inconnu » (`emailStatusLabel`);
 * - `failed`: bounced, failed, or never queued (the function's stamp: `not_configured`, …); also
 *   no email at all once EMAIL_PENDING_MS have passed (the function never finished);
 * - `pending`: no email yet, the link issued less than EMAIL_PENDING_MS ago (the send is running).
 */
export type InvitationEmail =
  | { kind: 'copied' | 'sent' | 'unknown' | 'pending' }
  | { kind: 'failed'; reason: InvitationEmailFailure }
export type InvitationEmailFailure = 'not_configured' | 'refused' | 'rate_limited' | 'other'

/** How long a link may wait for its email before it reads « pas parti ». */
export const EMAIL_PENDING_MS = 2 * 60_000

const SENT_STATUSES: ReadonlySet<string> = new Set(['queued', 'sent', 'delivered', 'delivery_delayed', 'complained'])

/** The link's handover at `now` (see InvitationEmail). */
export function invitationEmail(invitation: InvitationInfo, now: number = Date.now()): InvitationEmail {
  if (invitation.delivery === 'copied') return { kind: 'copied' }
  const { emailStatus: status, emailError: code } = invitation
  if (status !== null) {
    if (SENT_STATUSES.has(status)) return { kind: 'sent' }
    if (status === 'failed' && code === 'provider_unavailable') return { kind: 'unknown' }
    if (status === 'bounced' || code === 'invalid_recipient') return { kind: 'failed', reason: 'refused' }
    return status === 'failed' ? { kind: 'failed', reason: 'other' } : { kind: 'unknown' }
  }
  if (code === 'not_configured' || code === 'module_disabled') return { kind: 'failed', reason: 'not_configured' }
  if (code === 'invalid_recipient') return { kind: 'failed', reason: 'refused' }
  if (code === 'rate_limited') return { kind: 'failed', reason: 'rate_limited' }
  if (code !== null) return { kind: 'failed', reason: 'other' }
  return now - Date.parse(invitation.sentAt) < EMAIL_PENDING_MS ? { kind: 'pending' } : { kind: 'failed', reason: 'other' }
}

/** Why the email did not leave, in one plain sentence (« La clinique n'a pas encore configuré … »). */
export function emailFailureReason(reason: InvitationEmailFailure): string {
  return t(`${O}.emailFailure.${reason}`)
}

/** « Résultat inconnu » and its hint, as every email status reads (`emailStatusLabel`). */
export function unknownEmailOutcome(): { label: string; detail: string } {
  const { label, detail } = emailStatusLabel('failed', 'provider_unavailable')
  return { label, detail: detail ?? '' }
}

/**
 * The three ways to email a link (P4-260: each issues a new link and revokes the previous one):
 * a first invitation (or after a revocation), again while the link works, or after it expired.
 */
export const INVITE_ACTIONS = ['send', 'resend', 'new_link'] as const
export type InviteAction = (typeof INVITE_ACTIONS)[number]

interface OnboardingActions {
  /** « Envoyer l'invitation », « Renvoyer l'invitation » or « Envoyer un nouveau lien ». */
  invite: InviteAction | null
  /** « Révoquer l'invitation »: only while the link works. */
  revoke: boolean
  /** « Demander une mise à jour »: an account, and no submission open (one at a time). */
  requestUpdate: boolean
  /** « Copier le lien d'invitation » (P4-491): whenever an invitation can be sent (no account yet). */
  copyLink: boolean
}

const NO_ACTIONS: OnboardingActions = { invite: null, revoke: false, requestUpdate: false, copyLink: false }

/**
 * What the record offers, as `professionals-invite` allows it (`professionals.invite`): nothing
 * for an inactive file (P4-303); without an account, an invitation (any other status, P4-171);
 * with one, an update request while no submission is open.
 */
export function onboardingActions(
  professional: Pick<Professional, 'status' | 'profileId'>,
  onboarding: Onboarding | null,
  can: Can,
  now: number = Date.now(),
): OnboardingActions {
  if (!can('professionals.invite') || professional.status === 'inactive') return NO_ACTIONS
  if (professional.profileId !== null) return { invite: null, revoke: false, requestUpdate: !onboarding?.submission, copyLink: false }
  const state = invitationState(onboarding?.invitation, now)
  if (state === 'sent' || state === 'opened') return { invite: 'resend', revoke: true, requestUpdate: false, copyLink: true }
  return { invite: state === 'expired' ? 'new_link' : 'send', revoke: false, requestUpdate: false, copyLink: true }
}

/** The menu's and the buttons' words: they say exactly what the click does. */
export function onboardingActionLabel(action: InviteAction | 'revoke' | 'requestUpdate' | 'copyLink'): string {
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
 * · expire le 15 oct. », « Lien expiré le 15 oct. : envoyez un nouveau lien. », « Invitation
 * acceptée le 9 oct. », « Invitation révoquée : le lien ne fonctionne plus. », or « Aucune
 * invitation envoyée. ». A link not yet opened says how it was handed over (P4-490): « Lien copié
 * le … », « Courriel d'invitation non parti … », « Envoi en cours », « Résultat inconnu ».
 */
export function invitationLine(invitation: InvitationInfo | null, now: number): string {
  if (!invitation) return t(`${O}.invitation.none`)
  const d = (iso: string) => shortDate(iso, now)
  switch (invitationState(invitation, now) ?? invitation.state) {
    case 'sent': {
      const values = { sent: d(invitation.sentAt), expires: d(invitation.expiresAt) }
      const email = invitationEmail(invitation, now)
      if (email.kind === 'unknown') return t(`${O}.invitation.unknown`, { ...values, outcome: unknownEmailOutcome().label })
      return t(`${O}.invitation.${email.kind === 'sent' ? 'sent' : email.kind === 'failed' ? 'notSent' : email.kind}`, values)
    }
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
 * in, or not yet opened (no account). Null once approved. The open submission may be an update
 * (a file activated without an approved questionnaire, P4-179): it reads the same way, as
 * « Mise à jour envoyée le …, à réviser. » or « Mise à jour en cours : pas encore envoyée. »
 * (P4-497), never « Aucun questionnaire en cours ».
 */
export function questionnaireLine(professional: Pick<Professional, 'profileId'>, onboarding: Onboarding | null, now: number): string | null {
  if (onboarding?.onboardingApproved) return null
  const submission = onboarding?.submission ?? null
  const update = submission?.kind === 'update' ? 'Update' : ''
  if (submission?.status === 'submitted') {
    return submission.submittedAt
      ? t(`${O}.questionnaire.submitted${update}`, { date: shortDate(submission.submittedAt, now) })
      : t(`${O}.questionnaire.submitted${update}Undated`)
  }
  if (professional.profileId === null) return t(`${O}.questionnaire.afterInvitation`)
  return submission ? t(`${O}.questionnaire.inProgress${update}`) : t(`${O}.questionnaire.none`)
}

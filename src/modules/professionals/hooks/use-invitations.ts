import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { retryInText } from '@/shared/lib/retry-after'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { toast } from '@/shared/ui/sonner'
import {
  fetchInvitationStates,
  fetchProfessionalEmails,
  fetchProfessionalOnboarding,
  requestProfessionalUpdate,
  revokeProfessionalInvitation,
  sendProfessionalInvitation,
  type EmailProblem,
} from '../api/invitations'
import type { SubmissionSection } from '../lib/constants'
import type { InviteAction } from '../lib/onboarding'
import { professionalKeys } from './keys'
import { functionErrorMessage, showMutationError, type MutationFeedback } from './mutation-feedback'
import { refreshProfessionalHistory } from './use-professional-record'

const I = 'modules.professionals.onboarding'

// --- Reads ---------------------------------------------------------------------------------------

const onboardingQuery = (id: string) => queryOptions({ queryKey: professionalKeys.onboarding(id), queryFn: () => fetchProfessionalOnboarding(id) })

/** The record's onboarding line, requested in the same tick as the record (P4-270): no waterfall. */
export function useProfessionalOnboarding(id: string) {
  return useQuery({ ...onboardingQuery(id), enabled: id !== '' })
}

/** With the record's prefetch (list row hover or focus). */
export function prefetchProfessionalOnboarding(queryClient: QueryClient, id: string): Promise<void> {
  return queryClient.prefetchQuery(onboardingQuery(id))
}

/** The whole clinic's onboarding states, requested in parallel with the list (one request, P4-270). */
export function useInvitationStates() {
  return useQuery({ queryKey: professionalKeys.invitationStates(), queryFn: fetchInvitationStates })
}

const emailsQuery = (id: string) =>
  queryOptions({ queryKey: professionalKeys.emails(id), queryFn: () => fetchProfessionalEmails(id), staleTime: 30_000 })

/** The professional's emails for Historique (fetched with its first page, no refetch on focus). */
export function useProfessionalEmails(id: string) {
  return useQuery({ ...emailsQuery(id), enabled: id !== '', refetchOnWindowFocus: false })
}

/** Historique's hover or focus: the emails with the first audit page. */
export function prefetchProfessionalEmails(queryClient: QueryClient, id: string): Promise<void> {
  return queryClient.prefetchQuery(emailsQuery(id))
}

// --- Messages ------------------------------------------------------------------------------------

/**
 * The French text of a failed call to `professionals-invite`: its own refusals (too many calls,
 * the module switched off, the function unreachable, an expired session); the RPC refusals it
 * passes on go through `showMutationError` (as is, or « Permission refusée » with the access
 * refetched). Null for those. A 429 here created nothing; its body does not say which limit
 * refused it (the file's 5 s guard against a double click, or the caller's hourly count, P4-261),
 * so the text names neither: « Trop de demandes en peu de temps. Réessayez dans … ».
 */
export function invitationFunctionMessage(error: unknown): string | null {
  return functionErrorMessage(error)
}

const EMAIL_PROBLEMS = ['not_configured', 'rate_limited', 'provider_error', 'invalid_request', 'module_disabled'] as const
const isKnownProblem = (code: string): code is (typeof EMAIL_PROBLEMS)[number] => (EMAIL_PROBLEMS as readonly string[]).includes(code)

/** What the email that did not leave was about: an invitation link, or an update request (and to whom). */
export type EmailAbout = { kind: 'invitation' } | { kind: 'update'; firstName: string }

/**
 * Why the email did not leave, and what to do (the toast's second line).
 * - An invitation: « Utilisez « Renvoyer l'invitation » dans un moment. » only where re-sending can
 *   help: a refused address must be corrected first (the cause says where), an unconfigured
 *   sender or a module switched off fails again until someone acts; a sending limit says when.
 * - An update request stays open whatever the cause, and has no re-send (P4-267): every cause
 *   ends with how the professional learns of it (« La demande reste ouverte : prévenez {Prénom}
 *   … »). A refused address is corrected by the professional in « Mon compte » (an account
 *   exists): there is no invitation to re-send.
 */
export function emailProblemText({ code, retryAfter }: EmailProblem, about: EmailAbout): string {
  const known = isKnownProblem(code) ? code : 'other'
  if (about.kind === 'update') {
    const { firstName } = about
    const cause = known === 'invalid_request' ? t(`${I}.emailProblems.invalid_request_update`, { firstName }) : t(`${I}.emailProblems.${known}`)
    return `${cause} ${t(`${I}.emailAdvice.update`, { firstName })}`
  }
  const cause = t(`${I}.emailProblems.${known}`)
  if (known === 'rate_limited') return `${cause} ${retryInText(retryAfter)}`
  if (known === 'invalid_request' || known === 'not_configured' || known === 'module_disabled') return cause
  return `${cause} ${t(`${I}.emailAdvice.invitation`)}`
}

// --- Actions -------------------------------------------------------------------------------------

/**
 * After any action, done or refused: the record (and its onboarding line), the lists (and the
 * states) and the history (and its emails). A refusal often means the file changed meanwhile (an
 * account created, the link revoked by a colleague).
 */
function refreshAfterAction(queryClient: QueryClient, id: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: professionalKeys.record(id) }),
    queryClient.invalidateQueries({ queryKey: professionalKeys.lists() }),
    // The first page only (the new entries are at its top), and the emails under it.
    refreshProfessionalHistory(queryClient, id),
  ])
}

/**
 * A failed action: the function's own refusals in plain words; any other failure of the function
 * (unreachable answer, an internal error) says which action failed, and is reported; the RPC
 * refusals it passes on as for an RPC (`showMutationError`).
 */
function onActionError(queryClient: QueryClient, error: unknown, feedback: MutationFeedback | undefined, failed: string) {
  const known = invitationFunctionMessage(error)
  if (known === null && !(error instanceof FunctionCallError)) return showMutationError(queryClient, error, feedback)
  const message = known ?? moduleErrorMessage(error, failed, 'professionals')
  if (feedback?.onErrorMessage) feedback.onErrorMessage(message, error)
  else toast.error(message)
}

export interface InvitationVariables {
  id: string
  action: InviteAction
  /** The file's address, for the confirmation (the function sends to the file's own address). */
  email: string
}

/**
 * « Envoyer l'invitation », « Renvoyer l'invitation », « Envoyer un nouveau lien ». Success: « Invitation
 * envoyée à {courriel}. Le lien expire le {date}. »; the link created but its email failed: a
 * warning that says so and what to do. The refreshes are awaited: the dialog closes on fresh data.
 */
export function useSendInvitation(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action }: InvitationVariables) => sendProfessionalInvitation(id, action),
    onSuccess: ({ expiresAt, emailProblem }, { email }) => {
      if (emailProblem) toast.warning(t(`${I}.toasts.createdNotSent`), { description: emailProblemText(emailProblem, { kind: 'invitation' }) })
      else if (expiresAt) toast.success(t(`${I}.toasts.sentExpires`, { email, date: formatClinicDateShort(expiresAt) }))
      else toast.success(t(`${I}.toasts.sent`, { email }))
    },
    onError: (error) => onActionError(queryClient, error, feedback, t(`${I}.errors.sendFailed`)),
    onSettled: (_data, _error, { id }) => refreshAfterAction(queryClient, id),
  })
}

/** « Révoquer l'invitation » (after its confirmation). */
export function useRevokeInvitation(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string }) => revokeProfessionalInvitation(id),
    onSuccess: () => {
      toast.success(t(`${I}.toasts.revoked`))
    },
    onError: (error) => onActionError(queryClient, error, feedback, t(`${I}.errors.revokeFailed`)),
    onSettled: (_data, _error, { id }) => refreshAfterAction(queryClient, id),
  })
}

/** « Demander une mise à jour »: the request is open even when its email failed (P4-267). */
export function useRequestUpdate(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, sections }: { id: string; sections: readonly SubmissionSection[]; email: string; firstName: string }) =>
      requestProfessionalUpdate(id, sections),
    onSuccess: ({ emailProblem }, { email, firstName }) => {
      if (emailProblem) {
        toast.warning(t(`${I}.toasts.updateNotSent`), { description: emailProblemText(emailProblem, { kind: 'update', firstName }) })
      } else toast.success(t(`${I}.toasts.updateSent`, { email }))
    },
    onError: (error) => onActionError(queryClient, error, feedback, t(`${I}.errors.updateFailed`)),
    onSettled: (_data, _error, { id }) => refreshAfterAction(queryClient, id),
  })
}

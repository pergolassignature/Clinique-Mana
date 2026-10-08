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
import { showMutationError, type MutationFeedback } from './mutation-feedback'

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

/** The function's limit for one file (P4-261): a refused double click. */
const FILE_GUARD_SECONDS = 5

/**
 * The French text of a failed call to `professionals-invite`: its own refusals (a double click
 * within 5 s, the caller's hourly limit, the module switched off, the function unreachable, an
 * expired session); the RPC refusals it passes on go through `showMutationError` (as is, or
 * « Permission refusée » with the access refetched). Null for those.
 */
export function invitationFunctionMessage(error: unknown): string | null {
  if (!(error instanceof FunctionCallError)) return null
  switch (error.code) {
    case 'rate_limited':
      return error.retryAfter !== null && error.retryAfter <= FILE_GUARD_SECONDS
        ? t(`${I}.errors.justSent`)
        : `${t(`${I}.errors.rateLimited`)} ${retryInText(error.retryAfter)}`
    case 'module_disabled':
      return t(`${I}.errors.moduleDisabled`)
    case 'network':
      return t(`${I}.errors.network`)
    case 'unauthenticated':
      return t(`${I}.errors.unauthenticated`)
    case 'not_configured':
      return t(`${I}.errors.unavailable`)
    default:
      return null
  }
}

const EMAIL_PROBLEMS = ['not_configured', 'rate_limited', 'provider_error', 'invalid_request', 'module_disabled'] as const
const isKnownProblem = (code: string): code is (typeof EMAIL_PROBLEMS)[number] => (EMAIL_PROBLEMS as readonly string[]).includes(code)

/**
 * Why the email did not leave, and what to do (the toast's second line). « Renvoyer
 * l'invitation » is advised only where it can help: a refused address must be corrected first, an
 * unconfigured sender fails again until someone configures it. An update request has no re-send
 * (P4-267): the professional is told another way.
 */
export function emailProblemText({ code, retryAfter }: EmailProblem, advice: string): string {
  const known = isKnownProblem(code) ? code : 'other'
  const cause = t(`${I}.emailProblems.${known}`)
  if (known === 'rate_limited') return `${cause} ${retryInText(retryAfter)}`
  if (known === 'invalid_request' || known === 'not_configured' || known === 'module_disabled') return cause
  return `${cause} ${advice}`
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
    queryClient.invalidateQueries({ queryKey: professionalKeys.history(id) }),
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
      if (emailProblem) toast.warning(t(`${I}.toasts.createdNotSent`), { description: emailProblemText(emailProblem, t(`${I}.emailAdvice.invitation`)) })
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
        toast.warning(t(`${I}.toasts.updateNotSent`), { description: emailProblemText(emailProblem, t(`${I}.emailAdvice.update`, { firstName })) })
      } else toast.success(t(`${I}.toasts.updateSent`, { email }))
    },
    onError: (error) => onActionError(queryClient, error, feedback, t(`${I}.errors.updateFailed`)),
    onSettled: (_data, _error, { id }) => refreshAfterAction(queryClient, id),
  })
}

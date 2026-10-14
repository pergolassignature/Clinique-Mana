import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t, type TranslationKey } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage, rpcErrorCode } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import {
  addAvailabilityException,
  bookAppointment,
  bookPersonalAppointment,
  cancelAppointment,
  cancelSeriesFrom,
  createSeries,
  deleteAvailabilityRule,
  fetchAgenda,
  fetchAgendaReference,
  fetchAppointmentDetail,
  fetchAvailability,
  fetchMyAgendaReference,
  moveAppointment,
  previewSeries,
  removeAvailabilityException,
  saveAvailabilityRule,
  setAppointmentDetails,
  setPresence,
  type BookInput,
  type ExceptionInput,
  type MoveInput,
  type PersonalInput,
  type RuleInput,
  type SeriesInput,
  type SeriesRule,
} from '../api/agenda'
import {
  changeAppointmentService,
  confirmAppointment,
  fetchAgendaSettings,
  fetchAppointmentConsents,
  fetchBookingConsents,
  restoreAppointment,
  saveAgendaSettings,
  type AgendaSettings,
} from '../api/changes'
import { APPOINTMENT_HISTORY_PAGE_SIZE, fetchAppointmentHistory } from '../api/history'
import { fetchAppointmentMessages, fetchWithoutReminder, resendAppointmentNotification } from '../api/messages'
import type { AppointmentMode, Presence } from '../api/parse'
import { appointmentsKeys } from './keys'

export function useAgenda(from: string, to: string, professionalIds: readonly string[] | null, enabled = true) {
  return useQuery({
    queryKey: appointmentsKeys.agenda(from, to, professionalIds),
    queryFn: () => fetchAgenda(from, to, professionalIds),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useAppointmentDetail(id: string | null) {
  return useQuery({ queryKey: appointmentsKeys.detail(id ?? ''), queryFn: () => fetchAppointmentDetail(id ?? ''), enabled: id !== null })
}

export function useAgendaReference() {
  return useQuery({ queryKey: appointmentsKeys.reference(), queryFn: fetchAgendaReference, staleTime: 5 * 60_000 })
}

/** « Mon agenda »: the professional's own reference (R5). */
export function useMyAgendaReference(enabled = true) {
  return useQuery({ queryKey: appointmentsKeys.myReference(), queryFn: fetchMyAgendaReference, staleTime: 5 * 60_000, enabled })
}

export function useAvailability(professionalIds: readonly string[], sinceIso: string) {
  return useQuery({
    queryKey: appointmentsKeys.availability(professionalIds, sinceIso),
    queryFn: () => fetchAvailability(professionalIds, sinceIso),
    enabled: professionalIds.length > 0,
    placeholderData: keepPreviousData,
  })
}

/** The dates of a series before booking it, with their conflicts (null rule: nothing to ask). */
export function useSeriesPreview(rule: SeriesRule | null) {
  return useQuery({
    queryKey: appointmentsKeys.seriesPreview(rule ?? {}),
    queryFn: () => (rule ? previewSeries(rule) : Promise.resolve([])),
    enabled: rule !== null,
    placeholderData: keepPreviousData,
  })
}

/** « Clients sans rappel »: the next 7 days, from this hour on. */
export function useWithoutReminder() {
  const from = new Date()
  from.setMinutes(0, 0, 0)
  const fromIso = from.toISOString()
  const toIso = new Date(from.getTime() + 7 * 86_400_000).toISOString()
  return useQuery({ queryKey: appointmentsKeys.withoutReminder(fromIso), queryFn: () => fetchWithoutReminder(fromIso, toIso) })
}

/** Where a failure is shown: in the dialog (with the error, for its HINT), else a toast. */
export interface MutationFeedback {
  onErrorMessage?: (message: string, error: unknown) => void
}

const S = 'modules.appointments.saved'

function useAgendaMutation<V, R>(mutationFn: (variables: V) => Promise<R>, successKey: TranslationKey | null, feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: appointmentsKeys.all })
      if (successKey) toast.success(t(successKey))
    },
    onError: (error) => {
      if (rpcErrorCode(error) === '42501') void queryClient.invalidateQueries({ queryKey: accessKeys.all })
      const message = moduleErrorMessage(error, t('modules.appointments.errors.saveFailed'), 'appointments')
      if (feedback?.onErrorMessage) feedback.onErrorMessage(message, error)
      else toast.error(message)
    },
  })
}

export const useBookAppointment = (feedback?: MutationFeedback) => useAgendaMutation((input: BookInput) => bookAppointment(input), `${S}.booked`, feedback)
export const useCreateSeries = (feedback?: MutationFeedback) => useAgendaMutation((input: SeriesInput) => createSeries(input), `${S}.series`, feedback)
export const useCancelSeriesFrom = (feedback?: MutationFeedback) =>
  useAgendaMutation(
    ({ id, reasonKey, details, keptOnSchedule }: { id: string; reasonKey: string; details: string | null; keptOnSchedule: boolean }) =>
      cancelSeriesFrom(id, reasonKey, details, keptOnSchedule),
    `${S}.seriesCancelled`,
    feedback,
  )
export const useBookPersonal = (feedback?: MutationFeedback) =>
  useAgendaMutation((input: PersonalInput) => bookPersonalAppointment(input), `${S}.personal`, feedback)
export const useMoveAppointment = (feedback?: MutationFeedback) => useAgendaMutation((input: MoveInput) => moveAppointment(input), `${S}.moved`, feedback)
export const useSetAppointmentDetails = (feedback?: MutationFeedback) =>
  useAgendaMutation(
    ({ id, mode, internalNote, clientMessage }: { id: string; mode: AppointmentMode; internalNote: string | null; clientMessage: string | null }) =>
      setAppointmentDetails(id, mode, internalNote, clientMessage),
    `${S}.details`,
    feedback,
  )
export const useSetPresence = (feedback?: MutationFeedback) =>
  useAgendaMutation(
    ({ appointmentId, clientId, presence }: { appointmentId: string; clientId: string; presence: Presence }) => setPresence(appointmentId, clientId, presence),
    null,
    feedback,
  )
export const useCancelAppointment = (feedback?: MutationFeedback) =>
  useAgendaMutation(
    ({ id, reasonKey, details, keptOnSchedule }: { id: string; reasonKey: string; details: string | null; keptOnSchedule: boolean }) =>
      cancelAppointment(id, reasonKey, details, keptOnSchedule),
    `${S}.cancelled`,
    feedback,
  )
export const useSaveAvailabilityRule = (feedback?: MutationFeedback) => useAgendaMutation((input: RuleInput) => saveAvailabilityRule(input), `${S}.rule`, feedback)
export const useDeleteAvailabilityRule = (feedback?: MutationFeedback) => useAgendaMutation((id: string) => deleteAvailabilityRule(id), `${S}.ruleDeleted`, feedback)
export const useAddException = (feedback?: MutationFeedback) => useAgendaMutation((input: ExceptionInput) => addAvailabilityException(input), `${S}.exception`, feedback)
export const useRemoveException = (feedback?: MutationFeedback) => useAgendaMutation((id: string) => removeAvailabilityException(id), `${S}.exceptionRemoved`, feedback)

// --- The parity audit's gaps (AP-28 … AP-32) ------------------------------------------------------

export const useChangeService = (feedback?: MutationFeedback) =>
  useAgendaMutation(
    ({ id, serviceId, outsideAvailabilityReason }: { id: string; serviceId: string; outsideAvailabilityReason: string | null }) =>
      changeAppointmentService(id, serviceId, outsideAvailabilityReason),
    `${S}.serviceChanged`,
    feedback,
  )
export const useRestoreAppointment = (feedback?: MutationFeedback) => useAgendaMutation((id: string) => restoreAppointment(id), `${S}.restored`, feedback)
export const useConfirmAppointment = (feedback?: MutationFeedback) => useAgendaMutation((id: string) => confirmAppointment(id), `${S}.confirmed`, feedback)
export const useSaveAgendaSettings = (feedback?: MutationFeedback) => useAgendaMutation((s: AgendaSettings) => saveAgendaSettings(s), `${S}.settings`, feedback)

/** The consents an appointment requires (shown, never blocking: R-47). */
export function useAppointmentConsents(appointmentId: string | null) {
  return useQuery({
    queryKey: appointmentsKeys.consents(appointmentId ?? ''),
    queryFn: () => fetchAppointmentConsents(appointmentId ?? ''),
    enabled: appointmentId !== null,
  })
}

/** The consents a booking would require, once a service and a client are chosen. */
export function useBookingConsents(serviceId: string, clientIds: readonly string[]) {
  return useQuery({
    queryKey: appointmentsKeys.bookingConsents(serviceId, clientIds),
    queryFn: () => fetchBookingConsents(serviceId, clientIds),
    enabled: serviceId !== '' && clientIds.length > 0,
    placeholderData: keepPreviousData,
  })
}

/** An appointment's « Historique », 50 rows a page (keyset on the audit id), read when the tab opens. */
export function useAppointmentHistory(id: string) {
  return useInfiniteQuery({
    queryKey: appointmentsKeys.history(id),
    queryFn: ({ pageParam }) => fetchAppointmentHistory(id, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.length < APPOINTMENT_HISTORY_PAGE_SIZE ? undefined : (last.at(-1)?.id ?? undefined)),
  })
}

export function useAgendaSettings() {
  return useQuery({ queryKey: appointmentsKeys.settings(), queryFn: fetchAgendaSettings })
}

/** The sheet's « Messages » (AP-47). */
export function useAppointmentMessages(id: string) {
  return useQuery({ queryKey: appointmentsKeys.messages(id), queryFn: () => fetchAppointmentMessages(id) })
}

/** « Renvoyer la notification »: says how many went (or that nobody can be reached); refreshes the messages. */
export function useResendNotification(id: string, feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => resendAppointmentNotification(id),
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: appointmentsKeys.messages(id) })
      if (count > 0) toast.success(t('modules.appointments.editor.messages.resent', { count: String(count) }))
      else toast.error(t('modules.appointments.editor.messages.nobody'))
    },
    onError: (error) => {
      if (rpcErrorCode(error) === '42501') void queryClient.invalidateQueries({ queryKey: accessKeys.all })
      const message = moduleErrorMessage(error, t('modules.appointments.errors.saveFailed'), 'appointments')
      if (feedback?.onErrorMessage) feedback.onErrorMessage(message, error)
      else toast.error(message)
    },
  })
}

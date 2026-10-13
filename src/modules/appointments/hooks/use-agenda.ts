import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t, type TranslationKey } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage, rpcErrorCode } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import {
  addAvailabilityException,
  bookAppointment,
  cancelAppointment,
  cancelSeriesFrom,
  createSeries,
  deleteAvailabilityRule,
  fetchAgenda,
  fetchAgendaReference,
  fetchAppointmentDetail,
  fetchAvailability,
  moveAppointment,
  previewSeries,
  removeAvailabilityException,
  saveAvailabilityRule,
  setAppointmentDetails,
  setPresence,
  type BookInput,
  type ExceptionInput,
  type MoveInput,
  type RuleInput,
  type SeriesInput,
  type SeriesRule,
} from '../api/agenda'
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

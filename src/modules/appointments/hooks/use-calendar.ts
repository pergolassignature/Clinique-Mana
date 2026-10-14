import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import {
  disconnectGoogleCalendar,
  fetchMyCalendarSetup,
  finishGoogleCalendarConnect,
  listExternalBusy,
  startGoogleCalendarConnect,
  syncGoogleCalendar,
} from '../api/calendar'
import { calendarErrorMessage } from '../api/calendar-errors'
import { leaveFor } from '../lib/leave-for'
import { appointmentsKeys } from './keys'

const C = 'modules.appointments.calendar'

/**
 * Query keys of the Google busy times (R6), under the module's root (`['appointments']`): every
 * agenda write refetches them too, and a connection's change refetches `all` (her setup and the
 * agenda's « Occupé »).
 */
export const calendarKeys = {
  all: [...appointmentsKeys.all, 'calendar'] as const,
  mine: () => [...calendarKeys.all, 'mine'] as const,
  busy: (from: string, to: string, professionalIds: readonly string[] | null) => [...calendarKeys.all, 'busy', from, to, professionalIds] as const,
}

/** The caller's own Google connection (« Agenda Google » in her space); null when she is not a professional. */
export function useMyCalendarSetup() {
  return useQuery({ queryKey: calendarKeys.mine(), queryFn: fetchMyCalendarSetup, staleTime: 0 })
}

/** The agenda's « Occupé » times (times only), for the professionals shown; `enabled` false asks nothing. */
export function useExternalBusy(from: string, to: string, professionalIds: readonly string[] | null, enabled = true) {
  return useQuery({
    queryKey: calendarKeys.busy(from, to, professionalIds),
    queryFn: () => listExternalBusy(from, to, professionalIds),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 60_000,
  })
}

/** « Connecter mon agenda Google » / « Reconnecter »: asks for Google's consent URL, then leaves the app for it. */
export function useStartCalendarConnect() {
  return useMutation({
    mutationFn: () => startGoogleCalendarConnect(),
    onSuccess: (url) => leaveFor(url),
    onError: (error) => toast.error(calendarErrorMessage(error)),
  })
}

/**
 * The return from Google: stores the connection. A one-shot query keyed on the state, not a
 * mutation (as Zoom's return): the code is good once, and a query is asked once per key even when
 * the page mounts twice (StrictMode). Never refetched, never retried; `null` arguments ask nothing.
 */
export function useFinishCalendarConnect(code: string | null, state: string | null) {
  const queryClient = useQueryClient()
  return useQuery({
    // Its own root, outside `calendarKeys.all`: no invalidation may ever post the spent code again.
    queryKey: ['appointments-google-calendar-return', state] as const,
    queryFn: async () => {
      try {
        return await finishGoogleCalendarConnect(code!, state!)
      } finally {
        await queryClient.invalidateQueries({ queryKey: calendarKeys.all })
      }
    },
    enabled: code !== null && state !== null,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

/** « Synchroniser »: her busy times read again at once; the outcome said in French. */
export function useSyncCalendar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => syncGoogleCalendar(),
    onSuccess: (outcome) => {
      if (outcome === 'synced') toast.success(t(`${C}.synced`))
      else if (outcome === 'reconnect') toast.error(t(`${C}.syncReconnect`))
      else toast.error(t(`${C}.syncFailed`))
    },
    onError: (error) => toast.error(calendarErrorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: calendarKeys.all }),
  })
}

/** « Déconnecter »: her busy times no longer shown nor counted. */
export function useDisconnectCalendar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => disconnectGoogleCalendar(),
    onSuccess: () => toast.success(t(`${C}.disconnected`)),
    onError: (error) => toast.error(calendarErrorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: calendarKeys.all }),
  })
}

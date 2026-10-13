import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import {
  disconnectZoom,
  fetchAppointmentVideo,
  fetchMyVideoSetup,
  finishZoomConnect,
  listProfessionalNames,
  listProfessionalVideoStatus,
  retryAppointmentVideo,
  setProfessionalVideoLink,
  startZoomConnect,
} from '../api/video'
import { videoErrorMessage } from '../api/video-errors'
import { leaveFor } from '../lib/leave-for'
import { appointmentsKeys } from './keys'

const V = 'modules.appointments.video'

/**
 * Query keys of the video links (RZ), under the module's root (`['appointments']`, the agenda's
 * keys too): every write refetches `all` (the setups, the professionals' list, the appointments'
 * links), so the agenda's reads that show a link follow a change of setup.
 */
export const videoKeys = {
  all: [...appointmentsKeys.all, 'video'] as const,
  mine: () => [...videoKeys.all, 'mine'] as const,
  professionals: () => [...videoKeys.all, 'professionals'] as const,
  names: () => [...videoKeys.all, 'names'] as const,
  appointment: (id: string) => [...videoKeys.all, 'appointment', id] as const,
}

/** The caller's own setup (« Vidéoconférence » in her space); null when she is not a professional. */
export function useMyVideoSetup() {
  return useQuery({ queryKey: videoKeys.mine(), queryFn: fetchMyVideoSetup, staleTime: 0 })
}

/**
 * Each professional's setup the caller may see, by professional id (staff: every professional with
 * a connection or a fixed link; a professional: hers). For the settings list, the booking's warning
 * (« pas de Zoom connecté ») and the agenda's professional picker (R2, R5).
 */
export function useProfessionalVideoStatus() {
  return useQuery({ queryKey: videoKeys.professionals(), queryFn: listProfessionalVideoStatus })
}

/** The clinic's professionals by name (Professionnels' directory; empty without `professionals.view`). */
export function useProfessionalNames(enabled = true) {
  return useQuery({ queryKey: videoKeys.names(), queryFn: listProfessionalNames, enabled })
}

/** An appointment's effective link (« Démarrer », « Réessayer »). */
export function useAppointmentVideo(appointmentId: string | null) {
  return useQuery({
    queryKey: videoKeys.appointment(appointmentId ?? ''),
    queryFn: () => fetchAppointmentVideo(appointmentId as string),
    enabled: appointmentId !== null,
  })
}

/** A professional's fixed link; the page shows a refusal under the field (`onErrorMessage`). */
export function useSetVideoLink(feedback?: { onErrorMessage?: (message: string) => void }) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ professionalId, url }: { professionalId: string; url: string }) => setProfessionalVideoLink(professionalId, url),
    onSuccess: (_data, { url }) => toast.success(t(url.trim() === '' ? `${V}.fixed.removed` : `${V}.fixed.saved`)),
    onError: (error) => {
      const message = videoErrorMessage(error)
      if (feedback?.onErrorMessage) feedback.onErrorMessage(message)
      else toast.error(message)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: videoKeys.all }),
  })
}

/** « Connecter mon Zoom » / « Reconnecter »: asks for Zoom's consent URL, then leaves the app for it. */
export function useStartZoomConnect() {
  return useMutation({
    mutationFn: () => startZoomConnect(),
    onSuccess: (url) => leaveFor(url),
    onError: (error) => toast.error(videoErrorMessage(error)),
  })
}

/**
 * The return from Zoom: stores the connection. A one-shot query keyed on the state, not a mutation:
 * the code is good once, and a query is asked once per key even when the page mounts twice
 * (StrictMode), where a mutation started in an effect would post the same code twice (the second
 * refused as `link_used`). Never refetched, never retried; `null` arguments ask nothing.
 */
export function useFinishZoomConnect(code: string | null, state: string | null) {
  const queryClient = useQueryClient()
  return useQuery({
    // Its own root, outside `videoKeys.all`: no invalidation may ever post the spent code again.
    queryKey: ['appointments-zoom-return', state] as const,
    queryFn: async () => {
      try {
        return { email: await finishZoomConnect(code!, state!) }
      } finally {
        await queryClient.invalidateQueries({ queryKey: videoKeys.all })
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

/** « Déconnecter »: her new video appointments then use her fixed link. */
export function useDisconnectZoom() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => disconnectZoom(),
    onSuccess: () => toast.success(t(`${V}.zoom.disconnected`)),
    onError: (error) => toast.error(videoErrorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: videoKeys.all }),
  })
}

/** « Réessayer » on an appointment whose meeting failed. */
export function useRetryAppointmentVideo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (appointmentId: string) => retryAppointmentVideo(appointmentId),
    onSuccess: () => toast.success(t(`${V}.appointment.retried`)),
    onError: (error) => toast.error(videoErrorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: videoKeys.all }),
  })
}

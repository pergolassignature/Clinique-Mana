import { t } from '@/i18n'
import type { StatusTone } from '@/shared/ui/status-dot'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import type { VideoSetup } from '../api/video'

const V = 'modules.appointments.video'

/**
 * How a professional's video meetings run (R-55), one word each: her Zoom (connected), her Zoom to
 * reconnect, her fixed link, or nothing yet. A Zoom to reconnect with a fixed link still says
 * « À reconnecter »: the new appointments use the fixed link meanwhile, the detail says so.
 */
export type VideoReadiness = 'zoom' | 'reconnect' | 'fixed' | 'none'

export function videoReadiness(setup: Pick<VideoSetup, 'zoom_state' | 'fixed_url'> | null | undefined): VideoReadiness {
  if (setup?.zoom_state === 'connected') return 'zoom'
  if (setup?.zoom_state === 'needs_reconnect') return 'reconnect'
  if (setup?.fixed_url) return 'fixed'
  return 'none'
}

const TONES: Record<VideoReadiness, StatusTone> = { zoom: 'success', fixed: 'success', reconnect: 'warning', none: 'error' }

/** « Zoom connecté », « Lien fixe », « Zoom à reconnecter », « Aucun lien vidéo », with its dot. */
export function videoReadinessLabel(readiness: VideoReadiness): { label: string; tone: StatusTone } {
  return { label: t(`${V}.readiness.${readiness}`), tone: TONES[readiness] }
}

/** The line under a Zoom state: who and since when, or why it must be reconnected. */
export function zoomDetail(setup: VideoSetup): string | null {
  if (setup.zoom_state === 'connected') {
    const since = setup.zoom_connected_at ? formatClinicDateShort(setup.zoom_connected_at) : null
    if (setup.zoom_email && since) return t(`${V}.zoom.connectedAs`, { email: setup.zoom_email, date: since })
    return since ? t(`${V}.zoom.connectedSince`, { date: since }) : null
  }
  if (setup.zoom_state === 'needs_reconnect') return t(`${V}.zoom.reconnectWhy`)
  if (setup.zoom_reconnect_reason === 'deauthorized') return t(`${V}.zoom.deauthorized`)
  return null
}

/** The address of `zoom-deauthorize` for this clinic (Zoom's « Event notification endpoint URL »). */
export function zoomWebhookUrl(orgId: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zoom-deauthorize?org=${encodeURIComponent(orgId)}`
}

/** The app path Zoom sends the browser back to (`_shared/zoom/env.ts` RETURN_PATH). */
export const ZOOM_RETURN_PATH = '/mon-agenda/videoconference'

/** What the browser checks of a fixed link before the database does: an https address, at most 500 characters. */
export function fixedLinkError(value: string): string | null {
  const url = value.trim()
  if (url === '') return null
  if (url.length > 500) return t(`${V}.fixed.tooLong`)
  if (!/^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]{1,5})?([/?#]\S*)?$/.test(url)) return t(`${V}.fixed.invalid`)
  return null
}

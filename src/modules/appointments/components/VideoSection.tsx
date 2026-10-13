import { ExternalLink, RotateCcw } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { Button } from '@/shared/ui/button'
import { useAppointmentVideo, useRetryAppointmentVideo } from '../hooks/use-video'

const V = 'modules.appointments.editor.video'

/**
 * The editor's « Vidéo » (R5, with lane C's RZ): the appointment's effective link
 * (`get_appointment_video`): « Démarrer » opens it; while Zoom prepares it, says so; after three
 * failures, « Réessayer »; with neither Zoom nor a fixed link, says the professional has none.
 */
export function VideoSection({ appointmentId }: { appointmentId: string }) {
  const { can } = useAccess()
  const video = useAppointmentVideo(appointmentId)
  const retry = useRetryAppointmentVideo()
  if (!video.data) return null
  const v = video.data
  return (
    <section className="space-y-2" aria-label={t(`${V}.title`)}>
      <h3 className="text-sm font-medium">{t(`${V}.title`)}</h3>
      {v.status === 'ready' && v.url ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild>
            <a href={v.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden />
              {t(`${V}.start`)}
            </a>
          </Button>
          <span className="text-xs text-muted-foreground">{t(v.source === 'zoom' ? `${V}.zoom` : `${V}.fixed`)}</span>
        </div>
      ) : v.status === 'pending' ? (
        <p className="text-sm text-muted-foreground">{t(`${V}.pending`)}</p>
      ) : v.status === 'failed' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t(`${V}.failed`)}</span>
          {(can('appointments.manage') || can('appointments.self')) && (
            <Button type="button" variant="outline" size="sm" aria-disabled={retry.isPending || undefined} onClick={() => !retry.isPending && retry.mutate(appointmentId)}>
              <RotateCcw aria-hidden />
              {t(`${V}.retry`)}
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t(`${V}.none`)}</p>
      )}
    </section>
  )
}

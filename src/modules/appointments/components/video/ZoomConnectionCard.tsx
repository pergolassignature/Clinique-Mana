import { useRef } from 'react'
import { TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog'
import { Button, buttonVariants } from '@/shared/ui/button'
import { StatusDot } from '@/shared/ui/status-dot'
import type { VideoSetup } from '../../api/video'
import { useDisconnectZoom, useStartZoomConnect } from '../../hooks/use-video'
import { videoReadinessLabel, zoomDetail } from '../../lib/video'

const Z = 'modules.appointments.video.zoom'

/**
 * « Zoom »: the professional's own Zoom account (RZ). Connected, each of her video appointments gets
 * its own meeting, moved and deleted with it, and its link is emailed to the clients. « Connecter
 * mon Zoom » leaves for Zoom's consent page and comes back here; « Déconnecter » (confirmed) ends it
 * (her fixed link is used meanwhile); « Reconnecter » when Zoom refused the clinic's access.
 */
export function ZoomConnectionCard({ setup }: { setup: VideoSetup }) {
  const connect = useStartZoomConnect()
  const state = setup.zoom_state
  const live = state === 'connected' || state === 'needs_reconnect'
  const status = videoReadinessLabel(state === 'connected' ? 'zoom' : state === 'needs_reconnect' ? 'reconnect' : 'none')
  const detail = zoomDetail(setup)
  return (
    <SettingsCard as="section" title={t(`${Z}.title`)} description={t(`${Z}.description`)}>
      <p className="inline-flex items-center gap-1.5 text-sm text-foreground">
        <StatusDot tone={state === 'connected' ? 'success' : state === 'needs_reconnect' ? 'warning' : 'neutral'} />
        {state === 'connected' || state === 'needs_reconnect' ? status.label : t(`${Z}.notConnected`)}
      </p>
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      {state === 'needs_reconnect' && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertDescription className="text-foreground">{t(`${Z}.reconnectNotice`)}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {state !== 'connected' && (
          <Button
            type="button"
            aria-disabled={connect.isPending || undefined}
            className={cn(softDisabledClasses, 'max-sm:h-11')}
            onClick={ignoreWhenInactive(connect.isPending, () => connect.mutate())}
          >
            {connect.isPending ? t(`${Z}.leaving`) : state === 'needs_reconnect' ? t(`${Z}.reconnect`) : t(`${Z}.connect`)}
          </Button>
        )}
        {live && <DisconnectButton />}
      </div>
      {state !== 'connected' && <p className="text-xs text-muted-foreground">{t(`${Z}.connectHelp`)}</p>}
    </SettingsCard>
  )
}

/** « Déconnecter », confirmed: the clinic's access to her Zoom ends; her meetings stay in her Zoom. */
function DisconnectButton() {
  const disconnect = useDisconnectZoom()
  const confirmed = useRef(false)
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" aria-disabled={disconnect.isPending || undefined} className={cn(softDisabledClasses, 'max-sm:h-11')}>
          {disconnect.isPending ? t(`${Z}.disconnecting`) : t(`${Z}.disconnect`)}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!confirmed.current) return
          event.preventDefault()
          confirmed.current = false
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${Z}.disconnectConfirm.title`)}</AlertDialogTitle>
          <AlertDialogDescription>{t(`${Z}.disconnectConfirm.body`)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            onClick={() => {
              confirmed.current = true
              if (!disconnect.isPending) disconnect.mutate()
            }}
          >
            {t(`${Z}.disconnectConfirm.action`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

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
import type { CalendarSetup } from '../../api/calendar'
import { useDisconnectCalendar, useStartCalendarConnect, useSyncCalendar } from '../../hooks/use-calendar'
import { calendarAccountLine, calendarReconnectWhy, calendarSyncLine } from '../../lib/calendar'

const C = 'modules.appointments.calendar'

/**
 * « Agenda Google » (R6): the professional's own Google agenda, opt-in (AP-40). Connected, the
 * clinic reads only when she is busy (never a title, AP-41): those times show « Occupé » in the
 * agenda and are never offered as open slots. « Connecter mon agenda Google » leaves for Google's
 * consent page and comes back here; « Synchroniser » reads them again at once; « Déconnecter »
 * (confirmed) ends it and deletes the busy times; « Reconnecter » when Google refused the access.
 */
export function GoogleCalendarCard({ setup }: { setup: CalendarSetup }) {
  const connect = useStartCalendarConnect()
  const sync = useSyncCalendar()
  const state = setup.state
  const account = state ? calendarAccountLine(setup) : null
  return (
    <SettingsCard as="section" title={t(`${C}.title`)} description={t(`${C}.description`)}>
      <p className="inline-flex items-center gap-1.5 text-sm text-foreground">
        <StatusDot tone={state === 'connected' ? 'success' : state === 'needs_reconnect' ? 'warning' : 'neutral'} />
        {state === 'connected' ? t(`${C}.connected`) : state === 'needs_reconnect' ? t(`${C}.toReconnect`) : t(`${C}.notConnected`)}
      </p>
      {account && <p className="text-xs text-muted-foreground">{account}</p>}
      {state === 'connected' && <p className="text-xs text-muted-foreground">{calendarSyncLine(setup)}</p>}
      {state === 'needs_reconnect' && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertDescription className="text-foreground">
            {calendarReconnectWhy(setup.reconnect_reason)} {t(`${C}.reconnectNotice`)}
          </AlertDescription>
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
            {connect.isPending ? t(`${C}.leaving`) : state === 'needs_reconnect' ? t(`${C}.reconnect`) : t(`${C}.connect`)}
          </Button>
        )}
        {state === 'connected' && (
          <Button
            type="button"
            variant="outline"
            aria-disabled={sync.isPending || undefined}
            className={cn(softDisabledClasses, 'max-sm:h-11')}
            onClick={ignoreWhenInactive(sync.isPending, () => sync.mutate())}
          >
            {sync.isPending ? t(`${C}.syncing`) : t(`${C}.sync`)}
          </Button>
        )}
        {state !== null && <DisconnectButton />}
      </div>
      {state !== 'connected' && <p className="text-xs text-muted-foreground">{t(`${C}.connectHelp`)}</p>}
    </SettingsCard>
  )
}

/** « Déconnecter », confirmed: the clinic no longer reads her busy times; those read are deleted. */
function DisconnectButton() {
  const disconnect = useDisconnectCalendar()
  const confirmed = useRef(false)
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" aria-disabled={disconnect.isPending || undefined} className={cn(softDisabledClasses, 'max-sm:h-11')}>
          {disconnect.isPending ? t(`${C}.disconnecting`) : t(`${C}.disconnect`)}
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
          <AlertDialogTitle>{t(`${C}.disconnectConfirm.title`)}</AlertDialogTitle>
          <AlertDialogDescription>{t(`${C}.disconnectConfirm.body`)}</AlertDialogDescription>
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
            {t(`${C}.disconnectConfirm.action`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

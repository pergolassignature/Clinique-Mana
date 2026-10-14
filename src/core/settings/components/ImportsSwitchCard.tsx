import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { useImportsStatus, useSetImportsOpen } from '@/core/settings/imports/hooks'
import type { ImportsStatus } from '@/core/settings/imports/api'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
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

/** « Modifié le … par … », the last close when the switch is open again, or « jamais fermées ». */
function StatusDetails({ status }: { status: ImportsStatus }) {
  const lines: string[] = []
  if (status.changedAt) {
    const date = formatClinicDateTime(status.changedAt)
    lines.push(
      status.changedByName
        ? t('settings.modules.imports.changed', { date, name: status.changedByName })
        : t('settings.modules.imports.changedNoName', { date }),
    )
  }
  // Open again: when they were last closed, apart from the reopen.
  if (status.open && status.closedAt) lines.push(t('settings.modules.imports.lastClosed', { date: formatClinicDateTime(status.closedAt) }))
  if (lines.length === 0) lines.push(t('settings.modules.imports.neverChanged'))
  return (
    <>
      {lines.map((line) => (
        <p key={line} className="text-xs text-muted-foreground">
          {line}
        </p>
      ))}
    </>
  )
}

/**
 * Paramètres → Modules, « Importation GOrendezvous » (`modules.manage`, as the page; hidden
 * without it): whether the clinic's GOrendezvous import RPCs are open (`organizations.imports_open`,
 * decision I-22), the switch's last change (when, by whom), and « Fermer les importations » /
 * « Rouvrir les importations » after a confirmation saying what it does. Closed, every `import_*`
 * RPC refuses « Les imports sont fermés pour cette clinique. ».
 */
export function ImportsSwitchCard() {
  const { can } = useAccess()
  const allowed = can('modules.manage')
  const { data: status, isPending, isError, isFetching, refetch } = useImportsStatus({ enabled: allowed })
  const setOpen = useSetImportsOpen()
  if (!allowed) return null

  const texts = status?.open ? 'closeConfirm' : 'reopenConfirm'
  const action = status?.open ? t('settings.modules.imports.close') : t('settings.modules.imports.reopen')
  const footer = status && (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-disabled={setOpen.isPending || undefined}
          className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          onClick={ignoreWhenInactive(setOpen.isPending)}
        >
          {action}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`settings.modules.imports.${texts}.title`)}</AlertDialogTitle>
          <AlertDialogDescription>{t(`settings.modules.imports.${texts}.body`)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: status.open ? 'destructive' : 'default' })}
            onClick={() => setOpen.mutate(!status.open)}
          >
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return (
    <SettingsCard as="section" title={t('settings.modules.imports.title')} description={t('settings.modules.imports.description')} footer={footer}>
      {isPending ? (
        <Loading />
      ) : isError && !status ? (
        <LoadError message={t('settings.modules.imports.loadError')} retrying={isFetching} onRetry={() => void refetch()} />
      ) : (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <StatusDot tone={status.open ? 'success' : 'neutral'} />
            {status.open ? t('settings.modules.imports.open') : t('settings.modules.imports.closedState')}
          </p>
          <StatusDetails status={status} />
        </div>
      )}
    </SettingsCard>
  )
}

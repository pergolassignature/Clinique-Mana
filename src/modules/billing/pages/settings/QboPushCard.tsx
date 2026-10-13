import { useState } from 'react'
import { t } from '@/i18n'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { StatusDot } from '@/shared/ui/status-dot'
import { toast } from '@/shared/ui/sonner'
import { billingErrorMessage } from '../../api/errors'
import type { QboSettings } from '../../api/quickbooks'
import { useQboPushes, useRetryQboPush, useSetQboPushPaused } from '../../hooks/use-quickbooks'
import { pushErrorText, pushKindLabel, pushStatusLabel } from '../../lib/qbo-push'

const P = 'modules.billing.qbo.push'

/**
 * « Envoi à QuickBooks » (FQ part 2, FQ-6): the switch — « En pause » by default, nothing sent;
 * « Démarrer l'envoi » (asked first) at the cutover's go/no-go — the counts, and the documents not
 * sent yet or refused, each with why in plain words and « Réessayer ».
 */
export function QboPushCard({ settings }: { settings: QboSettings }) {
  const connected = settings.connection?.status === 'connected'
  const push = settings.push
  const setPaused = useSetQboPushPaused()
  const [confirmStart, setConfirmStart] = useState(false)
  const change = (paused: boolean) =>
    setPaused.mutate(paused, {
      onSuccess: () => toast.success(paused ? t(`${P}.pausedToast`) : t(`${P}.startedToast`)),
      onError: (error) => toast.error(billingErrorMessage(error)),
    })

  return (
    <SettingsCard as="section" layout="section" title={t(`${P}.title`)} description={t(`${P}.description`)}>
      <div className="space-y-1">
        <p className="inline-flex items-center gap-1.5 text-sm text-foreground">
          <StatusDot tone={push.paused ? 'warning' : 'success'} />
          {push.paused ? t(`${P}.paused`) : t(`${P}.active`)}
        </p>
        <p className="tabular text-xs text-muted-foreground">
          {t(`${P}.counts`, {
            pushed: String(push.pushed),
            pending: String(push.pending),
            failed: String(push.failed),
            waiting: String(push.waiting_events),
          })}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border-light pt-3">
        {push.paused ? (
          <Button type="button" variant="outline" size="sm" disabled={!connected || setPaused.isPending} onClick={() => setConfirmStart(true)} className="max-sm:h-11">
            {t(`${P}.start`)}
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={setPaused.isPending} onClick={() => change(true)} className="max-sm:h-11">
            {t(`${P}.pause`)}
          </Button>
        )}
        {!connected && <p className="text-xs text-muted-foreground">{t(`${P}.connectFirst`)}</p>}
      </div>
      <PushList />
      <AlertDialog open={confirmStart} onOpenChange={setConfirmStart}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${P}.startTitle`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${P}.startBody`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => change(false)}>{t(`${P}.startAction`)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  )
}

/** The documents not sent (waiting or refused), newest first, with « Réessayer ». */
function PushList() {
  const pushes = useQboPushes(null)
  const retry = useRetryQboPush()
  if (pushes.isError && !pushes.data) {
    return <LoadError message={t(`${P}.loadError`)} retrying={pushes.isFetching} onRetry={() => void pushes.refetch()} />
  }
  if (!pushes.data) return <Loading />
  const open = pushes.data.pushes.filter((p) => p.status !== 'pushed' || p.amount_mismatch).slice(0, 20)
  if (open.length === 0) return <p className="text-sm text-muted-foreground">{t(`${P}.nothingOpen`)}</p>
  return (
    <ul aria-label={t(`${P}.openList`)} className="divide-y divide-border-light">
      {open.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="font-medium text-foreground">{pushKindLabel(p.kind)}</span>
            {p.invoice_number && <span className="text-muted-foreground"> · {p.invoice_number}</span>}
            <span className="block text-xs text-muted-foreground">
              {p.status === 'pushed' && p.amount_mismatch
                ? t(`${P}.mismatch`)
                : [pushStatusLabel(p.status), pushErrorText(p.last_error_code), p.status === 'pending' ? t(`${P}.nextTry`, { date: formatClinicDateTime(p.next_attempt_at) }) : null]
                    .filter(Boolean)
                    .join(' · ')}
            </span>
          </span>
          {p.status !== 'pushed' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate(p.id, {
                  onSuccess: () => toast.success(t(`${P}.retried`)),
                  onError: (error) => toast.error(billingErrorMessage(error)),
                })
              }
              className="max-sm:h-11"
            >
              {t(`${P}.retry`)}
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

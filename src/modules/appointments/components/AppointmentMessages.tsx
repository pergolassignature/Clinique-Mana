import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import type { AppointmentMessage } from '../api/messages'
import type { AgendaAppointment } from '../api/parse'
import { useAppointmentMessages, useResendNotification } from '../hooks/use-agenda'

const M = 'modules.appointments.editor.messages'
const SKIP_REASONS = ['no_consent', 'sms_off', 'cancelled', 'past', 'superseded', 'unreachable', 'reserved'] as const

/** A message's state in words: « En attente », « Envoyé le … », « Échec après N essais », « Non envoyé : … ». */
function statusText(m: AppointmentMessage): string {
  if (m.status === 'sent') return m.sentAt ? t(`${M}.status.sentAt`, { when: formatClinicDateTime(m.sentAt) }) : t(`${M}.status.sent`)
  if (m.status === 'failed') return t(`${M}.status.failed`, { attempts: String(m.attempts) })
  if (m.status === 'skipped') {
    const reason = SKIP_REASONS.find((r) => r === m.skipReason)
    return t(`${M}.status.skipped`, { reason: reason ? t(`${M}.skip.${reason}`) : t(`${M}.skip.other`) })
  }
  return t(`${M}.status.pending`)
}

const STATUS_VARIANT = { pending: 'secondary', sent: 'success', failed: 'error', skipped: 'outline' } as const

/**
 * The sheet's « Messages » (AP-47, parity audit L12): what the clinic sent this appointment's
 * clients (and their relations who receive it), newest first: the kind, the channel, to whom, and
 * its state in words. « Renvoyer la notification » (appointments.manage), for a coming appointment
 * that is booked, confirmed or cancelled: its confirmation or its cancellation again, by the same
 * channels (a text at once, an email with the messages job).
 */
export function AppointmentMessages({ appointment: a }: { appointment: AgendaAppointment }) {
  const { can } = useAccess()
  const messages = useAppointmentMessages(a.id)
  const resend = useResendNotification(a.id)
  const coming = new Date(a.startsAt).getTime() > Date.now()
  const canResend = can('appointments.manage') && coming && (a.state === 'booked' || a.state === 'confirmed' || a.state === 'cancelled')

  return (
    <div className="space-y-4">
      {canResend && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={resend.isPending || undefined}
            className={softDisabledClasses}
            onClick={ignoreWhenInactive(resend.isPending, () => resend.mutate())}
          >
            {t(`${M}.resend`)}
          </Button>
          <span className="text-xs text-muted-foreground">{t(a.state === 'cancelled' ? `${M}.resendCancelled` : `${M}.resendHelp`)}</span>
        </div>
      )}
      {messages.isError && !messages.data ? (
        <LoadError message={t(`${M}.loadError`)} onRetry={() => void messages.refetch()} retrying={messages.isFetching} />
      ) : !messages.data ? (
        <Loading />
      ) : messages.data.length === 0 ? (
        <EmptyState title={t(`${M}.empty`)} body={t(`${M}.emptyBody`)} inCard={false} />
      ) : (
        <ul className="space-y-2" aria-label={t(`${M}.label`)}>
          {messages.data.map((m) => (
            <li key={m.id} className="space-y-1 rounded-md border border-border p-3 text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{t(`${M}.kind.${m.kind}`)}</span>
                <span className="text-muted-foreground">
                  {t(`${M}.channel.${m.channel}`)} · {m.recipientName}
                </span>
              </p>
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant={STATUS_VARIANT[m.status]}>{statusText(m)}</Badge>
                <span className="text-muted-foreground">{t(`${M}.queuedAt`, { when: formatClinicDateTime(m.createdAt) })}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

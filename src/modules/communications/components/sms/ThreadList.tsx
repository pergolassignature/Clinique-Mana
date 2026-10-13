import { Paperclip } from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicDateShort, formatClinicTime, isClinicToday } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { StatusDot } from '@/shared/ui/status-dot'
import type { SmsThread } from '../../api/sms'
import { fileLabel } from '../../lib/inbox-format'
import { formatPhone } from '../../lib/phone'
import { smsConsentLabel, smsStatusLabel } from '../../lib/sms-status'

const T = 'modules.communications.sms.threads'

/** The latest text's time: the hour today, else the date. */
function when(at: string): string {
  return isClinicToday(at) ? formatClinicTime(at) : formatClinicDateShort(at)
}

/** One line of what was said last: « Vous : … » for the clinic's own text, the attachment, or the purge. */
function preview(thread: SmsThread): string {
  if (thread.lastBodyPurged) return t(`${T}.purged`)
  const text = thread.lastBody ?? (thread.lastHasMedia ? t(`${T}.attachment`) : t(`${T}.noText`))
  return thread.lastDirection === 'out' ? t(`${T}.you`, { text }) : text
}

interface ThreadListProps {
  threads: SmsThread[]
  selected: string | null
  onSelect: (phone: string) => void
}

/**
 * The conversations, newest first: the number, when, the last text (one line), the consent in
 * force and, for the clinic's own last text, its status when it is not plainly sent. Each row is a
 * button; the open one is `aria-current`.
 */
export function ThreadList({ threads, selected, onSelect }: ThreadListProps) {
  return (
    <ul aria-label={t(`${T}.label`)} className="divide-y divide-border-light">
      {threads.map((thread) => {
        const consent = smsConsentLabel(thread.consent)
        const status = thread.lastDirection === 'out' && thread.lastStatus !== 'sent' ? smsStatusLabel(thread.lastStatus) : null
        const current = thread.phone === selected
        return (
          <li key={thread.phone}>
            <button
              type="button"
              aria-current={current || undefined}
              onClick={() => onSelect(thread.phone)}
              className={cn(
                'flex w-full min-w-0 flex-col gap-0.5 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                current && 'bg-muted',
              )}
            >
              <span className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {thread.client ? (thread.client.clientNumber !== null ? fileLabel(thread.client.clientNumber, thread.client.name) : thread.client.name) : <span className="tabular">{formatPhone(thread.phone)}</span>}
                </span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">{when(thread.lastMessageAt)}</span>
              </span>
              {thread.client && <span className="tabular text-xs text-muted-foreground">{formatPhone(thread.phone)}</span>}
              <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                {thread.lastHasMedia && !thread.lastBodyPurged && <Paperclip aria-hidden className="size-3 shrink-0" />}
                <span className="truncate">{preview(thread)}</span>
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot tone={consent.tone} />
                  {consent.label}
                </span>
                {status && (
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <StatusDot tone={status.tone} />
                    {status.label}
                  </span>
                )}
                <span className="tabular">{thread.messageCount === 1 ? t(`${T}.messagesOne`) : t(`${T}.messagesOther`, { count: String(thread.messageCount) })}</span>
                {thread.linkStatus === 'needs_review' && <span className="font-medium text-foreground">{t(`${T}.toReview`)}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

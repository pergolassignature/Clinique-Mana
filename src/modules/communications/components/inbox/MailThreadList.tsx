import { Paperclip, Star } from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicDateShort, formatClinicTime, isClinicToday } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import type { MailThreadRow } from '../../api/inbox'
import { senderLabel } from '../../lib/inbox-format'

const T = 'modules.communications.inbox.list'

/** The latest message's time: the hour today, else the date. */
function when(at: string): string {
  return isClinicToday(at) ? formatClinicTime(at) : formatClinicDateShort(at)
}

interface MailThreadListProps {
  threads: MailThreadRow[]
  selected: string | null
  onSelect: (id: string) => void
  /** More pages: « Afficher plus de courriels ». */
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}

/**
 * The threads of the view, newest first: who wrote last, when, the subject and the last snippet
 * (one line each), a paperclip for attachments, a star when followed, the message count when more
 * than one. Unread threads are bold. Each row is a button; the open one is `aria-current`.
 */
export function MailThreadList({ threads, selected, onSelect, hasMore, loadingMore, onLoadMore }: MailThreadListProps) {
  return (
    <div>
      <ul aria-label={t(`${T}.label`)} className="divide-y divide-border-light">
        {threads.map((thread) => {
          const unread = thread.unread_count > 0
          const current = thread.id === selected
          return (
            <li key={thread.id}>
              <button
                type="button"
                aria-current={current || undefined}
                onClick={() => onSelect(thread.id)}
                className={cn(
                  'flex w-full min-w-0 flex-col gap-0.5 px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                  current && 'bg-muted',
                )}
              >
                <span className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className={cn('truncate text-sm text-foreground', unread ? 'font-semibold' : 'font-medium')}>
                    {senderLabel(thread.last_from_name, thread.last_from_address)}
                    {thread.message_count > 1 && <span className="tabular ml-1 font-normal text-muted-foreground">{thread.message_count}</span>}
                  </span>
                  <span className={cn('tabular shrink-0 text-xs', unread ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                    {when(thread.last_message_at)}
                  </span>
                </span>
                <span className="flex min-w-0 items-center gap-1">
                  {unread && <span className="sr-only">{t(`${T}.unread`)}</span>}
                  <span className={cn('truncate text-sm', unread ? 'font-semibold text-foreground' : 'text-foreground')}>
                    {thread.subject?.trim() || t(`${T}.noSubject`)}
                  </span>
                  {thread.label_ids.includes('STARRED') && (
                    <Star aria-label={t(`${T}.starred`)} className="size-3 shrink-0 fill-warning text-warning" />
                  )}
                  {thread.has_attachments && <Paperclip aria-label={t(`${T}.attachments`)} className="size-3 shrink-0 text-muted-foreground" />}
                </span>
                <span className="truncate text-xs text-muted-foreground">{thread.snippet ?? ''}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {hasMore && (
        <div className="border-t border-border-light p-3">
          <Button type="button" variant="outline" size="sm" className="w-full max-sm:h-11" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? t('common.loading') : t(`${T}.more`)}
          </Button>
        </div>
      )}
    </div>
  )
}

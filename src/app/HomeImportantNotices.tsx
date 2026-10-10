import { useId } from 'react'
import { TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import type { Notice } from '@/core/notifications/api'
import { noticeAge, noticeLinkPath } from '@/core/notifications/display'
import { useImportantNotices, useIsMarkingNotice, useOpenNotice } from '@/core/notifications/hooks'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useNow } from '@/shared/lib/use-now'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'

/**
 * Accueil « À surveiller » (design system Accueil): up to 5 important unread notices, reloaded
 * when the bell's polled count changes (no timer of its own: useImportantNotices). Nothing at all
 * when there are none, or when they cannot load (the bell still shows them). « Ouvrir » goes to
 * the notice's page and marks it read once there (not after « Rester »); a notice without a link
 * can only be marked read. Each button waits while its notice is being marked.
 *
 * The title is the list card's panel title (16/24, 600, as `CardTitle`; audit 2026-10-09 §2.2). The icon is the design system's warning triangle in
 * `warning-strong` (#9A7B05, ~4:1): the kit's `--warning` #E0B400 is ~2.2:1 on white, below the
 * 3:1 a meaningful icon needs (decision #30, as for the pending clock).
 */
export function HomeImportantNotices() {
  const headingId = useId()
  const { data: notices = [] } = useImportantNotices()
  const now = useNow(60_000)
  if (notices.length === 0) return null

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-2 text-lg font-semibold text-foreground">
        {t('notifications.watch.title')}
      </h2>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {notices.map((notice) => (
          <NoticeRow key={notice.id} notice={notice} now={now} />
        ))}
      </ul>
    </section>
  )
}

function NoticeRow({ notice, now }: { notice: Notice; now: number }) {
  const titleId = useId()
  const openNotice = useOpenNotice()
  const pending = useIsMarkingNotice(notice.id)
  const linked = noticeLinkPath(notice.link_path) !== null
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-strong" aria-hidden />
      <div className="min-w-0 flex-1">
        <p id={titleId} className="text-sm font-medium text-foreground">
          {notice.title}
        </p>
        {notice.body && <p className="mt-0.5 text-xs text-muted-foreground">{notice.body}</p>}
        <time dateTime={notice.created_at} title={formatClinicDateTime(notice.created_at)} className="mt-0.5 block text-xs text-muted-foreground">
          {noticeAge(notice.created_at, now)}
        </time>
      </div>
      <Button
        variant={linked ? 'outline' : 'ghost'}
        size="sm"
        aria-describedby={titleId}
        aria-disabled={pending || undefined}
        onClick={ignoreWhenInactive(pending, () => openNotice(notice))}
        className={cn(
          softDisabledClasses,
          'shrink-0 max-sm:h-11',
          linked
            ? 'aria-disabled:hover:border-border aria-disabled:hover:bg-card'
            : 'aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground',
        )}
      >
        {linked ? t('notifications.watch.open') : t('notifications.watch.dismiss')}
      </Button>
    </li>
  )
}

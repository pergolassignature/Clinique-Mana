import { useId } from 'react'
import { TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import type { Notice } from '@/core/notifications/api'
import { noticeAge, noticeLinkPath } from '@/core/notifications/display'
import { useImportantNotices, useOpenNotice } from '@/core/notifications/hooks'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useNow } from '@/shared/lib/use-now'
import { Button } from '@/shared/ui/button'

/**
 * Accueil « À surveiller » (design system Accueil): up to 5 important unread notices, polled like
 * the bell. Nothing at all when there are none, or when they cannot load (the bell still shows
 * them). « Ouvrir » marks the notice read and goes to its page; a notice without a link can only
 * be marked read.
 */
export function HomeImportantNotices() {
  const headingId = useId()
  const { data: notices = [] } = useImportantNotices()
  const now = useNow(60_000)
  if (notices.length === 0) return null

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-2 text-base font-semibold text-foreground">
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
  const linked = noticeLinkPath(notice.link_path) !== null
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1">
        <p id={titleId} className="text-sm font-medium text-foreground">
          {notice.title}
        </p>
        {notice.body && <p className="mt-0.5 text-xs text-muted-foreground">{notice.body}</p>}
        <time dateTime={notice.created_at} title={formatClinicDateTime(notice.created_at)} className="mt-0.5 block text-xs text-subtle">
          {noticeAge(notice.created_at, now)}
        </time>
      </div>
      <Button
        variant={linked ? 'outline' : 'ghost'}
        size="sm"
        aria-describedby={titleId}
        onClick={() => openNotice(notice)}
        className="shrink-0 max-sm:h-11"
      >
        {linked ? t('notifications.watch.open') : t('notifications.watch.dismiss')}
      </Button>
    </li>
  )
}

import { useEffect, useId, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { t } from '@/i18n'
import type { Notice, UnreadCount } from '@/core/notifications/api'
import { noticeAge } from '@/core/notifications/display'
import {
  useMarkAllNotificationsRead,
  useNotificationList,
  useOpenNotice,
  useUnreadNotificationCount,
} from '@/core/notifications/hooks'
import { Loading, LoadError } from '@/shared/components/LoadState'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useNow } from '@/shared/lib/use-now'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { focusRing } from '@/shared/ui/field-classes'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { TopbarIconButton } from './TopbarIconButton'

/** « Notifications, 3 non lues, dont 1 importante »: the bell's accessible name. */
function bellLabel({ total, important }: UnreadCount): string {
  if (total === 0) return t('notifications.bell')
  const unread =
    total === 1 ? t('notifications.unreadOne') : t('notifications.unreadOther', { count: String(total) })
  if (important === 0) return `${t('notifications.bell')}, ${unread}`
  const urgent =
    important === 1
      ? t('notifications.importantOne')
      : t('notifications.importantOther', { count: String(important) })
  return `${t('notifications.bell')}, ${unread}, ${urgent}`
}

const NO_UNREAD: UnreadCount = { total: 0, important: 0 }

/**
 * The topbar bell (design system Topbar: icon 16, a 6 px dot). The dot is teal when something is
 * unread, red when one of them is important; the count polls every minute (P3-24). The popover
 * loads the list only while open. Choosing a notice closes the popover, gives focus back to the
 * bell, then marks the notice read and goes to its link through the unsaved-changes guard (so
 * after « Rester » focus is on the bell, not on <body>).
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // The notice chosen in the list: opened once the popover has closed (onCloseAutoFocus).
  const chosen = useRef<Notice | null>(null)
  const count = useUnreadNotificationCount().data ?? NO_UNREAD
  const list = useNotificationList(open)
  const openNotice = useOpenNotice()

  const choose = (notice: Notice) => {
    chosen.current = notice
    setOpen(false)
  }

  const onClosed = (event: Event) => {
    const notice = chosen.current
    chosen.current = null
    if (!notice) return
    event.preventDefault()
    triggerRef.current?.focus()
    openNotice(notice)
  }

  // Focus the panel itself (it is announced by its title), not « Tout marquer comme lu »: one more
  // Enter right after opening must not mark everything read.
  const onOpened = (event: Event) => {
    event.preventDefault()
    contentRef.current?.focus()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <TopbarIconButton ref={triggerRef} aria-label={bellLabel(count)}>
          <span className="relative">
            <Bell className="h-4 w-4" aria-hidden />
            {count.total > 0 && (
              <span
                aria-hidden
                data-testid="notification-dot"
                data-tone={count.important > 0 ? 'important' : 'unread'}
                className={cn(
                  'absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ring-2 ring-background',
                  count.important > 0 ? 'bg-destructive' : 'bg-primary',
                )}
              />
            )}
          </span>
        </TopbarIconButton>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="end"
        sideOffset={8}
        aria-labelledby={titleId}
        onOpenAutoFocus={onOpened}
        onCloseAutoFocus={onClosed}
        className="flex max-h-[min(560px,75dvh)] w-[360px] max-w-[calc(100vw-2rem)] flex-col p-0"
      >
        <NotificationPanel titleId={titleId} list={list} hasUnread={count.total > 0} onChoose={choose} />
      </PopoverContent>
    </Popover>
  )
}

interface NotificationPanelProps {
  titleId: string
  list: ReturnType<typeof useNotificationList>
  /** From the polled count; the loaded rows may know better (see below). */
  hasUnread: boolean
  onChoose: (notice: Notice) => void
}

function NotificationPanel({ titleId, list, hasUnread, onChoose }: NotificationPanelProps) {
  const now = useNow(60_000)
  const markAll = useMarkAllNotificationsRead()
  const listRef = useRef<HTMLUListElement>(null)
  // Rows before « Charger plus »: focus then moves to the first new one (the button may go away).
  const loadMoreFrom = useRef<number | null>(null)
  const { data, isPending, isError, isFetching, refetch, hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError } =
    list
  const notices = data?.pages.flat() ?? []
  const anyUnread = hasUnread || notices.some((n) => !n.is_read)

  useEffect(() => {
    const from = loadMoreFrom.current
    if (isFetchingNextPage || from === null) return
    loadMoreFrom.current = null
    listRef.current?.querySelectorAll<HTMLButtonElement>(':scope > li > button')[from]?.focus()
  }, [isFetchingNextPage])

  let content
  if (isPending) {
    content = <Loading className="px-4 py-3" />
  } else if (isError && !data) {
    content = (
      <LoadError className="px-4 py-3" message={t('notifications.loadError')} retrying={isFetching} onRetry={() => void refetch()} />
    )
  } else if (notices.length === 0) {
    content = <p className="px-4 py-6 text-sm text-muted-foreground">{t('notifications.empty')}</p>
  } else {
    content = (
      <ul ref={listRef} className="divide-y divide-border">
        {notices.map((notice) => (
          <li key={notice.id}>
            <button
              type="button"
              onClick={() => onChoose(notice)}
              className={`flex w-full gap-2.5 px-4 py-2.5 text-left transition-colors duration-120 hover:bg-gray-50 ${focusRing} focus-visible:shadow-focus-inset`}
            >
              <span
                aria-hidden
                className={cn('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', notice.is_read ? 'bg-transparent' : 'bg-primary')}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cn('min-w-0 flex-1 text-sm', notice.is_read ? 'text-muted-foreground' : 'font-medium text-foreground')}>
                    {notice.title}
                  </span>
                  {notice.importance === 'important' && <Badge variant="error">{t('notifications.important')}</Badge>}
                </span>
                {!notice.is_read && <span className="sr-only">{t('notifications.unreadItem')}</span>}
                {notice.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{notice.body}</span>}
                <time
                  dateTime={notice.created_at}
                  title={formatClinicDateTime(notice.created_at)}
                  className="mt-1 block text-xs text-subtle"
                >
                  {noticeAge(notice.created_at, now)}
                </time>
              </span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-1.5">
        <h2 id={titleId} className="text-sm font-semibold text-foreground">
          {t('notifications.title')}
        </h2>
        {notices.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            aria-disabled={!anyUnread || markAll.isPending || undefined}
            onClick={ignoreWhenInactive(!anyUnread || markAll.isPending, () => markAll.mutate())}
            className={cn(softDisabledClasses, '-mr-2 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground')}
          >
            {t('notifications.markAllRead')}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      {hasNextPage && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-2">
          {isFetchNextPageError && !isFetchingNextPage && (
            <p role="alert" className="text-xs text-muted-foreground">
              {t('notifications.loadMoreError')}
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            aria-disabled={isFetchingNextPage || undefined}
            onClick={ignoreWhenInactive(isFetchingNextPage, () => {
              loadMoreFrom.current = notices.length
              void fetchNextPage()
            })}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            {isFetchingNextPage ? t('notifications.loadingMore') : t('notifications.loadMore')}
          </Button>
        </div>
      )}
    </>
  )
}

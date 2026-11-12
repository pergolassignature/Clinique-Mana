import { useEffect, useMemo, useRef } from 'react'
import {
  MailThreadMessages,
  ThreadArchiveButton,
  ThreadEmpty,
  ThreadHeader,
  ThreadLoading,
  ThreadReplyBar,
  ThreadTouchBar,
  useCoarsePointer,
  useThreadMenuActions,
  useThreadReplyActions,
  useThreadShortcuts,
  type ModifyThreadInput,
  type ThreadMenuAction,
  type ThreadPreview,
} from '@pergolas-signature/email-ui'
import { Check, ExternalLink, MoreHorizontal, Star, Tag } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { LoadError } from '@/shared/components/LoadState'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import type { MailAction, MailLabel, MailThread } from '../../api/inbox'
import type { ComposeMode } from '../../api/composer'
import { useMailAction, useMailLabels, useMailThread } from '../../hooks/use-inbox'
import { useMailThreadLink } from '../../hooks/use-client-links'
import { useComposerLauncher } from '../../hooks/use-composer-launcher'
import { useMediaQuery, WIDE_INBOX_QUERY } from '../../hooks/use-media-query'
import { initialContent } from '../../lib/compose'
import { canReplyAll, participants, toMailAction, toStackMessages } from '../../lib/email-ui'
import { fileLabel, gmailThreadUrl } from '../../lib/inbox-format'
import { ThreadClientLink } from './ThreadClientLink'

const V = 'modules.communications.inbox.thread'

/** The ⋯ menu's actions `gmail-modify` can do: no spam, no delete (the kit offers both). */
const MENU_KEYS = new Set(['flag', 'unread'])

/** The header's icon buttons, the kit's size: 32 px with a mouse, 44 px under `md` or with a finger. */
const ICON = 'h-8 w-8 max-md:h-11 max-md:w-11'
const TOUCH_ICON = 'h-11 w-11'

interface MailThreadViewProps {
  threadId: string
  /** Back to the list: the thread's « Retour », shown while list and thread are stacked (below `lg`). */
  onBack: () => void
  /** The row that opened it, painted while the thread loads. */
  preview?: ThreadPreview | null
  /** False when its row opened it: the row's click already marked it read. */
  markReadOnOpen?: boolean
  /** J / K: the next and the previous thread of the list. */
  onNextThread?: () => void
  onPrevThread?: () => void
}

/**
 * One thread, from `@pergolas-signature/email-ui`'s kit: its header (subject, who is on it, the
 * client file with `clients.view`, archive, follow, labels, Gmail, ⋯), its messages latest first
 * (the older ones behind « N messages précédents », the unread ones open), and « Répondre ·
 * Répondre à tous · Transférer » at the foot (a mouse: a bar; a finger: the touch bar, with
 * « Retour » on a phone). E archives, F forwards, R answers all, J / K move through the list.
 *
 * Opening an unread thread marks it read once, silently (as Gmail), unless its row opened it: the
 * row's click already did. The pane takes the focus once the thread is there, named by its subject.
 * Received HTML is sanitized in a sandboxed frame, remote images held (`MessageBodySlot`).
 */
export function MailThreadView({ threadId, onBack, preview, markReadOnOpen = true, onNextThread, onPrevThread }: MailThreadViewProps) {
  const thread = useMailThread(threadId)
  const data = thread.data ?? null
  // The file the thread belongs to (CM2b): only for whoever may see files (Clients enabled).
  const canSeeFiles = useAccess().can('clients.view')
  // « Répondre », « Répondre à tous », « Transférer » (CM3), inside the page's composer host.
  const composer = useComposerLauncher()
  const link = useMailThreadLink(threadId, canSeeFiles)
  // The labels of the thread's own mailbox (a link may open a thread of another one).
  const labels = useMailLabels(data?.connection_id ?? null).data ?? []
  const action = useMailAction()
  const markRead = useMailAction({ silent: true })
  const touch = useCoarsePointer()
  // List and thread side by side: no « Retour ».
  const wide = useMediaQuery(WIDE_INBOX_QUERY)
  const pane = useRef<HTMLElement>(null)
  const markedRead = useRef<string | null>(null)

  const messages = useMemo(() => (data ? toStackMessages(data) : []), [data])
  const run = (next: MailAction) => action.mutate({ threadIds: [threadId], action: next })
  const modify = (input: ModifyThreadInput) => {
    const next = toMailAction(input.action)
    if (next) run(next)
  }
  const linked = link.data?.status === 'linked' && link.data.client ? link.data.client : null
  const compose = (mode: ComposeMode) =>
    data &&
    composer?.open({
      kind: 'content',
      personKnown: linked !== null,
      fileLabel: linked ? fileLabel(linked.client_number, linked.display_name) : null,
      content: initialContent({ connectionId: data.connection_id, mode, thread: data, mailbox: data.mailbox }),
    })
  const inInbox = data?.label_ids.includes('INBOX') ?? false
  const starred = data?.label_ids.includes('STARRED') ?? false

  const replyActions = useThreadReplyActions(data ? canReplyAll(data) : false, {
    reply: () => compose('reply'),
    replyAll: () => compose('reply_all'),
    forward: () => compose('forward'),
  })
  const menu = useThreadMenuActions({
    modify,
    scope: { threadId, connectionId: data?.connection_id ?? null },
    messages,
    starred,
    spam: false,
    touch,
    // « Marquer comme non lu »: back to the list, where it shows unread again.
    onMarkUnread: onBack,
  }).filter((item) => MENU_KEYS.has(item.key))
  useThreadShortcuts(data !== null, {
    archive: inInbox ? () => run({ kind: 'archive' }) : undefined,
    forward: composer ? replyActions.handleForward : undefined,
    replyAll: composer ? replyActions.handleReplyAll : undefined,
    nextThread: onNextThread,
    prevThread: onPrevThread,
  })

  // The pane takes the focus once the thread is there (it is not rendered while it loads).
  const loaded = data !== null
  useEffect(() => {
    if (loaded) pane.current?.focus()
  }, [threadId, loaded])
  useEffect(() => {
    if (!markReadOnOpen || !data || data.unread_count === 0 || markedRead.current === threadId) return
    markedRead.current = threadId
    markRead.mutate({ threadIds: [threadId], action: { kind: 'read' } })
  }, [markReadOnOpen, data, threadId, markRead])

  const back = wide ? undefined : onBack
  if (thread.isPending) return <ThreadLoading preview={preview} onBack={back} />
  if (thread.isError && !data) {
    return <LoadError className="p-4" message={t(`${V}.loadError`)} retrying={thread.isFetching} onRetry={() => void thread.refetch()} />
  }
  if (!data || messages.length === 0) return <ThreadEmpty onBack={back} />

  const subject = data.subject?.trim() || t('modules.communications.inbox.list.noSubject')
  const icon = touch ? TOUCH_ICON : ICON
  const followLabel = starred ? t(`${V}.unstar`) : t(`${V}.star`)

  return (
    <section ref={pane} tabIndex={-1} aria-label={subject} className="flex min-h-0 min-w-0 flex-1 flex-col bg-card outline-none">
      <ThreadHeader
        title={subject}
        participants={participants(data)}
        // A finger has « Retour » in its bar at the foot.
        onBack={back}
        backInBar={touch}
        touch={touch}
        deal={canSeeFiles ? <ThreadClientLink threadId={threadId} /> : null}
        actions={
          <div className="flex items-center" role="group" aria-label={t(`${V}.actions`)}>
            <ThreadArchiveButton archived={!inInbox} touch={touch} onArchive={() => run({ kind: 'archive' })} onUnarchive={() => run({ kind: 'inbox' })} />
            {/* With a mouse from md, « Suivre » is a button; below, and with a finger, it is in ⋯. */}
            {!touch && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(ICON, 'max-md:hidden')}
                aria-label={followLabel}
                title={followLabel}
                onClick={() => run({ kind: starred ? 'unstar' : 'star' })}
              >
                <Star aria-hidden className={cn('size-4', starred && 'fill-warning text-warning')} />
              </Button>
            )}
            {labels.length > 0 && <LabelsMenu thread={data} labels={labels} onAction={run} className={icon} />}
            <a
              href={gmailThreadUrl(data.mailbox, data.gmail_thread_id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t(`${V}.openInGmail`)}
              title={t(`${V}.openInGmail`)}
              className={cn(icon, 'inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground')}
            >
              <ExternalLink aria-hidden className="size-4" />
            </a>
            <ThreadMenu items={menu} className={icon} />
          </div>
        }
      />
      <div className={cn('min-h-0 flex-1 overflow-y-auto', !touch && 'bg-muted/40 p-4')}>
        <MailThreadMessages threadId={threadId} messages={messages} flat={touch} mailboxEmailOf={() => data.mailbox} />
      </div>
      {composer &&
        (touch ? <ThreadTouchBar replyActions={replyActions} onBack={back} /> : <ThreadReplyBar replyActions={replyActions} />)}
    </section>
  )
}

/** ⋯: the kit's menu actions MANA can do, drawn with MANA's dropdown. */
function ThreadMenu({ items, className }: { items: ThreadMenuAction[]; className: string }) {
  if (items.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className={className} aria-label={t(`${V}.more`)} title={t(`${V}.more`)}>
          <MoreHorizontal aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map(({ key, icon: Icon, label, onSelect, separatorBefore, className: itemClass, iconClassName }) => [
          separatorBefore ? <DropdownMenuSeparator key={`${key}-rule`} className={itemClass} /> : null,
          <DropdownMenuItem key={key} onSelect={onSelect} className={itemClass}>
            <Icon aria-hidden className={cn('size-4', iconClassName)} />
            <span>{label}</span>
          </DropdownMenuItem>,
        ])}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** « Libellés »: the mailbox's labels, each one checked when the thread carries it; a click adds or removes it. */
function LabelsMenu({
  thread,
  labels,
  onAction,
  className,
}: {
  thread: MailThread
  labels: MailLabel[]
  onAction: (action: MailAction) => void
  className: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className={className} aria-label={t(`${V}.labels`)} title={t(`${V}.labels`)}>
          <Tag aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t(`${V}.labelsHint`)}</DropdownMenuLabel>
        {labels.map((label) => {
          const on = thread.label_ids.includes(label.gmail_label_id)
          return (
            <DropdownMenuItem
              key={label.gmail_label_id}
              onSelect={() => onAction({ kind: on ? 'unlabel' : 'label', label_id: label.gmail_label_id })}
            >
              <Check aria-hidden className={cn('size-4', !on && 'invisible')} />
              <span>{label.name}</span>
              <span className="sr-only">{on ? t(`${V}.labelOn`) : t(`${V}.labelOff`)}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

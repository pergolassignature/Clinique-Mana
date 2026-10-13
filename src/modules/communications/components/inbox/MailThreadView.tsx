import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Check, ChevronLeft, ExternalLink, Inbox, Mail, Paperclip, Star, Tag } from 'lucide-react'
import { t } from '@/i18n'
import { useSignedFileUrl, useSignedFileUrls } from '@/core/storage/hooks'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import type { MailAction, MailAttachment, MailLabel, MailMessage, MailThread } from '../../api/inbox'
import { useMailAction, useMailThread } from '../../hooks/use-inbox'
import { htmlHasContent, prepareEmailHtml } from '../../lib/email-html'
import { SafeEmailHtml } from '../SafeEmailHtml'
import { gmailThreadUrl, senderLabel } from '../../lib/inbox-format'

const V = 'modules.communications.inbox.thread'

/** « 12 ko », « 1,4 Mo ». */
function fileSize(bytes: number | null): string | null {
  if (bytes === null) return null
  if (bytes < 1024 * 1024) return t(`${V}.sizeKb`, { size: String(Math.max(1, Math.round(bytes / 1024))) })
  return t(`${V}.sizeMb`, { size: (bytes / 1024 / 1024).toLocaleString('fr-CA', { maximumFractionDigits: 1 }) })
}

interface MailThreadViewProps {
  threadId: string
  labels: MailLabel[]
  /** On a phone, the list and the thread are stacked: « Retour aux courriels ». */
  onBack: () => void
}

/**
 * One thread: its subject and actions (archive or back to the inbox, unread, follow, labels, open
 * in Gmail), then its messages oldest first. The unread ones and the latest are open, the others
 * folded to one line (a click opens them). Opening an unread thread marks it read, once, silently
 * (as Gmail). Received HTML is sanitized and shown in a sandboxed frame; remote images wait for
 * « Afficher les images ».
 */
export function MailThreadView({ threadId, labels, onBack }: MailThreadViewProps) {
  const thread = useMailThread(threadId)
  const action = useMailAction()
  const markRead = useMailAction({ silent: true })
  const heading = useRef<HTMLHeadingElement>(null)
  const markedRead = useRef<string | null>(null)

  // The subject takes the focus once the thread is there (the heading is not rendered while it loads).
  const loaded = Boolean(thread.data)
  useEffect(() => {
    if (loaded) heading.current?.focus()
  }, [threadId, loaded])
  useEffect(() => {
    const data = thread.data
    if (!data || data.unread_count === 0 || markedRead.current === threadId) return
    markedRead.current = threadId
    markRead.mutate({ threadIds: [threadId], action: { kind: 'read' } })
  }, [thread.data, threadId, markRead])

  if (thread.isPending) return <Loading className="p-4" />
  if (thread.isError && !thread.data) {
    return <LoadError className="p-4" message={t(`${V}.loadError`)} retrying={thread.isFetching} onRetry={() => void thread.refetch()} />
  }
  if (!thread.data) return <p className="p-4 text-sm text-muted-foreground">{t(`${V}.gone`)}</p>
  const data = thread.data
  const run = (next: MailAction) => action.mutate({ threadIds: [threadId], action: next })
  const inInbox = data.label_ids.includes('INBOX')
  const starred = data.label_ids.includes('STARRED')

  return (
    <section aria-labelledby={`${threadId}-subject`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="space-y-2 border-b border-border px-4 py-3">
        <Button type="button" variant="link" onClick={onBack} className="lg:hidden">
          <ChevronLeft aria-hidden />
          {t(`${V}.back`)}
        </Button>
        <h2 id={`${threadId}-subject`} ref={heading} tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">
          {data.subject?.trim() || t('modules.communications.inbox.list.noSubject')}
        </h2>
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t(`${V}.actions`)}>
          {inInbox ? (
            <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={() => run({ kind: 'archive' })}>
              <Archive aria-hidden />
              {t(`${V}.archive`)}
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={() => run({ kind: 'inbox' })}>
              <Inbox aria-hidden />
              {t(`${V}.toInbox`)}
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" className="max-sm:h-11" onClick={() => run({ kind: 'unread' })}>
            <Mail aria-hidden />
            {t(`${V}.markUnread`)}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={starred}
            className="max-sm:h-11"
            onClick={() => run({ kind: starred ? 'unstar' : 'star' })}
          >
            <Star aria-hidden className={cn(starred && 'fill-current')} />
            {starred ? t(`${V}.unstar`) : t(`${V}.star`)}
          </Button>
          {labels.length > 0 && <LabelsMenu thread={data} labels={labels} onAction={run} />}
          <a
            href={gmailThreadUrl(data.mailbox, data.gmail_thread_id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-link underline-offset-[3px] hover:underline"
          >
            <ExternalLink aria-hidden className="size-3.5" />
            {t(`${V}.openInGmail`)}
          </a>
        </div>
      </header>
      <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {data.messages.map((message, index) => (
          <MessageItem
            key={message.id}
            message={message}
            thread={data}
            openByDefault={message.is_unread || index === data.messages.length - 1}
          />
        ))}
      </ol>
    </section>
  )
}

/** « Libellés »: the mailbox's labels, each one checked when the thread carries it; a click adds or removes it. */
function LabelsMenu({ thread, labels, onAction }: { thread: MailThread; labels: MailLabel[]; onAction: (action: MailAction) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="max-sm:h-11">
          <Tag aria-hidden />
          {t(`${V}.labels`)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
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

/** The people a message went to, by name or address, joined. */
function recipients(list: MailMessage['to']): string {
  return list.map((r) => r.name?.trim() || r.address || '').filter(Boolean).join(', ')
}

/** One message: folded to one line, or open with its headers, body and attachments. */
function MessageItem({ message, thread, openByDefault }: { message: MailMessage; thread: MailThread; openByDefault: boolean }) {
  const [open, setOpen] = useState(openByDefault)
  const from = senderLabel(message.from_name, message.from_address)
  if (!open) {
    return (
      <li>
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className="flex w-full min-w-0 items-baseline gap-2 rounded-md border border-border-light px-3 py-2 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="shrink-0 font-medium text-foreground">{from}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{message.snippet ?? ''}</span>
          <span className="tabular shrink-0 text-xs text-muted-foreground">{formatClinicDateTime(message.sent_at)}</span>
        </button>
      </li>
    )
  }
  const to = recipients(message.to)
  const cc = recipients(message.cc)
  return (
    <li>
      <article aria-label={t(`${V}.messageLabel`, { from })} className="rounded-md border border-border bg-card">
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border-light px-3 py-2">
          <div className="min-w-0 text-sm">
            <p className="font-medium text-foreground">
              {from}
              {message.from_address && message.from_name && <span className="ml-1 font-normal text-muted-foreground">{`<${message.from_address}>`}</span>}
            </p>
            {to && <p className="text-xs text-muted-foreground">{t(`${V}.to`, { to })}</p>}
            {cc && <p className="text-xs text-muted-foreground">{t(`${V}.cc`, { cc })}</p>}
          </div>
          <p className="tabular text-xs text-muted-foreground">{formatClinicDateTime(message.sent_at)}</p>
        </header>
        <div className="px-3 py-2">
          <MessageBody message={message} />
        </div>
        <Attachments message={message} thread={thread} />
      </article>
    </li>
  )
}

/** The body: the sanitized HTML (cid images resolved, remote ones held), else the text, else why there is none. */
function MessageBody({ message }: { message: MailMessage }) {
  const [showImages, setShowImages] = useState(false)
  const inline = useMemo(
    () => message.attachments.filter((a) => a.content_id && a.stored_file_id && a.status === 'stored'),
    [message.attachments],
  )
  const { urls } = useSignedFileUrls(inline.map((a) => a.stored_file_id as string))
  const inlineImages = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of inline) {
      const url = urls.get(a.stored_file_id as string)
      if (url && a.content_id) map.set(a.content_id, url)
    }
    return map
  }, [inline, urls])
  const prepared = useMemo(
    () => (htmlHasContent(message.body_html) ? prepareEmailHtml(message.body_html as string, { inlineImages, showRemoteImages: showImages }) : null),
    [message.body_html, inlineImages, showImages],
  )

  if (message.body_purged) return <p className="text-sm text-muted-foreground">{t(`${V}.purged`)}</p>
  if (prepared) {
    return (
      <div className="space-y-2">
        {prepared.blockedImages > 0 && (
          <p className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
            {t(`${V}.imagesHeld`)}
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setShowImages(true)}>
              {t(`${V}.showImages`)}
            </Button>
          </p>
        )}
        <SafeEmailHtml html={prepared.html} />
      </div>
    )
  }
  if (message.body_text?.trim()) {
    return <p className="whitespace-pre-wrap break-words text-sm text-foreground">{message.body_text}</p>
  }
  return <p className="text-sm text-muted-foreground">{message.snippet || t(`${V}.noBody`)}</p>
}

/** The attachments (inline images aside): open the copy, or say why there is none and point to Gmail. */
function Attachments({ message, thread }: { message: MailMessage; thread: MailThread }) {
  const files = message.attachments.filter((a) => !a.is_inline)
  if (files.length === 0) return null
  return (
    <ul aria-label={t(`${V}.attachmentsLabel`)} className="flex flex-wrap gap-2 border-t border-border-light px-3 py-2">
      {files.map((file) => (
        <li key={file.id}>
          <AttachmentChip file={file} thread={thread} />
        </li>
      ))}
    </ul>
  )
}

function AttachmentChip({ file, thread }: { file: MailAttachment; thread: MailThread }) {
  const stored = file.status === 'stored' ? file.stored_file_id : null
  const url = useSignedFileUrl(stored, { refresh: true })
  const name = file.filename?.trim() || t(`${V}.unnamed`)
  const size = fileSize(file.size_bytes)
  const chip = 'inline-flex max-w-[16rem] items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs'
  if (stored) {
    return url.data ? (
      <a href={url.data.url} target="_blank" rel="noopener noreferrer" className={cn(chip, 'text-link hover:bg-muted/60')}>
        <Paperclip aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{name}</span>
        {size && <span className="tabular shrink-0 text-muted-foreground">{size}</span>}
      </a>
    ) : (
      <span className={cn(chip, 'text-muted-foreground')}>
        <Paperclip aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{name}</span>
      </span>
    )
  }
  const why = file.status === 'pending' ? t(`${V}.attachmentPending`) : t(`${V}.attachmentInGmail`)
  return (
    <span className={cn(chip, 'text-muted-foreground')}>
      <Paperclip aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{name}</span>
      <span className="shrink-0">· {why}</span>
      {file.status !== 'pending' && (
        <a
          href={gmailThreadUrl(thread.mailbox, thread.gmail_thread_id)}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-link underline-offset-[3px] hover:underline"
        >
          {t(`${V}.openInGmailShort`)}
        </a>
      )}
    </span>
  )
}

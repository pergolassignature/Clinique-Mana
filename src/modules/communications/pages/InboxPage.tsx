import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
import { Input } from '@/shared/ui/input'
import { MAIL_VIEWS, type MailView } from '../api/inbox'
import { MailboxNav, type ViewChoice } from '../components/inbox/MailboxNav'
import { MailThreadList } from '../components/inbox/MailThreadList'
import { MailThreadView } from '../components/inbox/MailThreadView'
import { DraftList } from '../components/inbox/DraftList'
import { ComposerHost } from '../components/composer/ComposerHost'
import { useMailLabels, useMailThreads } from '../hooks/use-inbox'
import { useMailConnections } from '../hooks/use-mailboxes'

const I = 'modules.communications.inbox'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEARCH_DELAY_MS = 300

/**
 * `?vue=` → the view: one of MAIL_VIEWS, or `libelle:<id>`; anything else is the inbox, and so is
 * « À rattacher » for whoever may not see files.
 */
function parseView(raw: string | null, canSeeFiles: boolean): ViewChoice {
  if (raw?.startsWith('libelle:')) return { view: 'label', labelId: raw.slice('libelle:'.length) || null }
  if (raw === 'to_link' && !canSeeFiles) return { view: 'inbox', labelId: null }
  if (raw === 'drafts') return { view: 'drafts', labelId: null }
  return (MAIL_VIEWS as readonly string[]).includes(raw ?? '') ? { view: raw as MailView, labelId: null } : { view: 'inbox', labelId: null }
}
const viewParam = (choice: ViewChoice) => (choice.view === 'label' ? `libelle:${choice.labelId}` : choice.view)

/**
 * « Courriels » (CM2, communications.inbox): the clinic's mailboxes, three panes from `lg` — the
 * mailbox and its views, the threads of the view (search, pages of 50), the open thread — and on a
 * phone the list, then the thread with « Retour aux courriels ». The address keeps the state
 * (`?boite=`, `?vue=`, `?q=`, `?fil=`: ids only, never an address or a subject), so a link or a
 * reload opens the same place. No timer: new mail comes with the sync (Pub/Sub, the 15-minute
 * job); the list is read again when the page is shown again.
 */
export function InboxPage() {
  usePageTitle(t(`${I}.title`))
  const connections = useMailConnections()
  const [params, setParams] = useSearchParams()
  const mailboxes = useMemo(() => (connections.data ?? []).filter((m) => m.status !== 'disconnected'), [connections.data])
  // The composer sends from a connected mailbox only (CM3).
  const sendable = useMemo(() => mailboxes.filter((m) => m.status === 'connected'), [mailboxes])
  const wanted = params.get('boite')
  const mailboxId = mailboxes.find((m) => m.id === wanted)?.id ?? mailboxes[0]?.id ?? null
  const canSeeFiles = useAccess().can('clients.view')
  const choice = parseView(params.get('vue'), canSeeFiles)
  const threadParam = params.get('fil')
  const threadId = threadParam && UUID.test(threadParam) ? threadParam : null
  const search = params.get('q') ?? ''
  const [typed, setTyped] = useState(search)

  const update = (changes: Record<string, string | null>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key)
          else next.set(key, value)
        }
        return next
      },
      { replace: true },
    )
  }

  // The search follows typing, 300 ms after the last key.
  useEffect(() => {
    if (typed === search) return
    const timer = setTimeout(() => update({ q: typed.trim() || null, fil: null }), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `update` is recreated each render; the timer reads the latest.
  }, [typed, search])

  // « Retour aux courriels » (phone): the focus goes back to the row that was open.
  const backTo = useRef<string | null>(null)
  useEffect(() => {
    if (threadId !== null || !backTo.current) return
    const row = document.querySelector<HTMLElement>(`[data-thread-id="${backTo.current}"]`)
    backTo.current = null
    row?.focus()
  }, [threadId])

  const labels = useMailLabels(mailboxId)
  const showDrafts = choice.view === 'drafts' && !search
  const query =
    mailboxId && !showDrafts ? { connectionId: mailboxId, view: search ? ('all' as const) : choice.view, labelId: search ? null : choice.labelId, search } : null
  const threads = useMailThreads(query)
  const rows = useMemo(() => threads.data?.pages.flat() ?? [], [threads.data])

  let list
  if (!mailboxId) list = null
  else if (showDrafts) list = <DraftList />
  else if (threads.isError && !threads.data) {
    list = <LoadError className="p-3" message={t(`${I}.list.loadError`)} retrying={threads.isFetching} onRetry={() => void threads.refetch()} />
  } else if (!threads.data) list = <Loading className="p-3" />
  else if (rows.length === 0) {
    list = (
      <p className="p-4 text-sm text-muted-foreground">
        {search ? t(`${I}.list.noResult`) : choice.view === 'to_link' ? t(`${I}.list.emptyToLink`) : t(`${I}.list.empty`)}
      </p>
    )
  } else {
    list = (
      <MailThreadList
        threads={rows}
        selected={threadId}
        onSelect={(id) => update({ fil: id })}
        hasMore={threads.hasNextPage}
        loadingMore={threads.isFetchingNextPage}
        onLoadMore={() => void threads.fetchNextPage()}
      />
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader level={1} title={t(`${I}.title`)} description={t(`${I}.description`)} />
      {connections.isError && !connections.data ? (
        <LoadError message={t(`${I}.mailboxesLoadError`)} retrying={connections.isFetching} onRetry={() => void connections.refetch()} />
      ) : !connections.data ? (
        <Loading />
      ) : !mailboxId ? (
        <EmptyState title={t(`${I}.noMailboxTitle`)} body={t(`${I}.noMailboxBody`)} />
      ) : (
        <ComposerHost mailboxes={sendable} onSent={(sentThread) => sentThread && update({ fil: sentThread })}>
        <div className="overflow-hidden rounded-lg border border-border bg-card lg:grid lg:h-[calc(100dvh-13rem)] lg:min-h-[32rem] lg:grid-cols-[13rem_22rem_minmax(0,1fr)]">
          <div className={cn('min-h-0 overflow-y-auto border-b border-border lg:border-r lg:border-b-0', threadId !== null && 'max-lg:hidden')}>
            <MailboxNav
              mailboxes={mailboxes}
              mailboxId={mailboxId}
              onMailbox={(id) => {
                setTyped('')
                update({ boite: id, fil: null, vue: null, q: null })
              }}
              current={choice}
              onView={(next) => {
                setTyped('')
                update({ vue: next.view === 'inbox' ? null : viewParam(next), fil: null, q: null })
              }}
              labels={labels.data ?? []}
              showToLink={canSeeFiles}
              canCompose={sendable.length > 0}
            />
          </div>
          <div className={cn('flex min-h-0 flex-col lg:border-r lg:border-border', threadId !== null && 'max-lg:hidden')}>
            <div className="border-b border-border-light p-3">
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  aria-label={t(`${I}.search`)}
                  placeholder={t(`${I}.searchPlaceholder`)}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  className="pl-8"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
          </div>
          {threadId !== null ? (
            <div className="flex min-h-0 min-w-0 flex-col">
              <MailThreadView
                key={threadId}
                threadId={threadId}
                onBack={() => {
                  backTo.current = threadId
                  update({ fil: null })
                }}
              />
            </div>
          ) : (
            <div className="hidden items-center justify-center p-6 text-sm text-muted-foreground lg:flex">{t(`${I}.thread.select`)}</div>
          )}
        </div>
        </ComposerHost>
      )}
    </div>
  )
}

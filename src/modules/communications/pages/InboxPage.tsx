import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmailUiProvider, MailListView, type ThreadPreview } from '@pergolas-signature/email-ui'
import { Search } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
import { useUrlParams } from '@/shared/lib/use-url-params'
import { Input } from '@/shared/ui/input'
import { MAIL_VIEWS, type MailView } from '../api/inbox'
import { MailboxNav, type ViewChoice } from '../components/inbox/MailboxNav'
import { EMAIL_UI_PORTS } from '../components/inbox/email-ui-ports'
import { MailThreadView } from '../components/inbox/MailThreadView'
import { DraftList } from '../components/inbox/DraftList'
import { ComposerHost } from '../components/composer/ComposerHost'
import { useMailLabels, useMailThreads } from '../hooks/use-inbox'
import { useMailConnections } from '../hooks/use-mailboxes'
import { BATCH_ACTIONS, toMailListRow } from '../lib/email-ui'
import { senderLabel } from '../lib/inbox-format'

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
 * phone the list, then the thread with « Retour aux courriels ». The list and the thread are PS Hub's
 * kit, `@pergolas-signature/email-ui` (a finger swipes a row to archive or to read, a long press
 * selects; infinite scroll, pull to refresh; the thread's stack and reply actions), fed through
 * `EMAIL_UI_PORTS`. The address keeps the state (`?boite=`, `?vue=`, `?q=`, `?fil=`: ids only, never
 * an address or a subject), so a link or a reload opens the same place. No timer: new mail comes with
 * the sync (Pub/Sub, the 15-minute job); the list is read again when the page is shown again, or
 * pulled.
 */
export function InboxPage() {
  usePageTitle(t(`${I}.title`))
  const navigate = useNavigate()
  const connections = useMailConnections()
  const { params, update: patchUrl } = useUrlParams()
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

  // The kit's rows are memoized: the callbacks they get must not change with the address.
  const patch = useRef(patchUrl)
  useLayoutEffect(() => {
    patch.current = patchUrl
  })
  const update = useCallback((changes: Record<string, string | null>) => patch.current(changes), [])
  // A row's click marks its thread read itself (the kit): that thread then does not again. Any other
  // way in (J / K, a link, a sent reply) leaves it to the thread.
  const [openedByRow, setOpenedByRow] = useState<string | null>(null)
  const openThread = useCallback(
    (id: string | null) => {
      setOpenedByRow(null)
      update({ fil: id })
    },
    [update],
  )
  const selectRow = useCallback(
    (id: string) => {
      setOpenedByRow(id)
      update({ fil: id })
    },
    [update],
  )
  const openLink = useCallback((href: string) => navigate(href), [navigate])

  // The search follows typing, 300 ms after the last key.
  useEffect(() => {
    if (typed === search) return
    const timer = setTimeout(() => update({ q: typed.trim() || null, fil: null }), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [typed, search, update])

  // « Retour aux courriels » (phone): the focus goes back to the row that was open.
  const backTo = useRef<string | null>(null)
  useEffect(() => {
    if (threadId !== null || !backTo.current) return
    const row = document.querySelector<HTMLElement>(`[data-row-key="${backTo.current}"]`)
    backTo.current = null
    row?.focus()
  }, [threadId])

  const labels = useMailLabels(mailboxId)
  const showDrafts = choice.view === 'drafts' && !search
  const query =
    mailboxId && !showDrafts ? { connectionId: mailboxId, view: search ? ('all' as const) : choice.view, labelId: search ? null : choice.labelId, search } : null
  const threads = useMailThreads(query)
  const source = useMemo(() => threads.data?.pages.flat() ?? [], [threads.data])
  const rows = useMemo(() => source.map(toMailListRow), [source])

  // The open thread's neighbours in the list (J / K), and its row while it loads.
  const at = threadId ? source.findIndex((row) => row.id === threadId) : -1
  const next = at >= 0 ? source[at + 1] : undefined
  const prev = at > 0 ? source[at - 1] : undefined
  const openRow = at >= 0 ? source[at] : undefined
  const preview: ThreadPreview | null = openRow
    ? {
        subject: openRow.subject?.trim() || t(`${I}.list.noSubject`),
        sender: senderLabel(openRow.last_from_name, openRow.last_from_address),
        snippet: openRow.snippet,
      }
    : null

  const searchField = (
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
  )
  const empty = search ? t(`${I}.list.noResult`) : choice.view === 'to_link' ? t(`${I}.list.emptyToLink`) : t(`${I}.list.empty`)

  let list
  if (!mailboxId) list = null
  else if (showDrafts) {
    list = (
      <>
        {searchField}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DraftList />
        </div>
      </>
    )
  } else if (threads.isError && !threads.data) {
    list = (
      <>
        {searchField}
        <LoadError className="p-3" message={t(`${I}.list.loadError`)} retrying={threads.isFetching} onRetry={() => void threads.refetch()} />
      </>
    )
  } else {
    const refreshing = threads.isRefetching && !threads.isFetchingNextPage
    list = (
      <MailListView
        rows={rows}
        isLoading={!threads.data}
        pagination={{
          hasNextPage: threads.hasNextPage,
          isFetchingNextPage: threads.isFetchingNextPage,
          fetchNextPage: () => void threads.fetchNextPage(),
          pageCount: threads.data?.pages.length ?? 0,
        }}
        selectedRowKey={threadId}
        onSelectRow={selectRow}
        onOpenLink={openLink}
        selectionResetKey={`${mailboxId}:${viewParam(choice)}:${search}`}
        isSearch={search !== ''}
        batchActions={BATCH_ACTIONS}
        emptyState={<p className="p-4 text-sm text-muted-foreground">{empty}</p>}
        // Pull to refresh reads the list again (the mailbox's own sync is Gmail's push and the job).
        refresh={{ onRefresh: () => void threads.refetch(), isSyncing: refreshing, isManualSyncing: refreshing }}
        header={searchField}
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
        <EmailUiProvider ports={EMAIL_UI_PORTS}>
          <ComposerHost mailboxes={sendable} onSent={(sentThread) => sentThread && openThread(sentThread)}>
            {/* One height at every width: the list and the thread scroll inside it (the kit's
                infinite scroll and pull to refresh follow the list's own scroller). */}
            <div className="flex h-[calc(100dvh-13rem)] min-h-[32rem] flex-col overflow-hidden rounded-lg border border-border bg-card lg:grid lg:grid-cols-[13rem_22rem_minmax(0,1fr)]">
              <div className={cn('shrink-0 border-b border-border lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-b-0', threadId !== null && 'max-lg:hidden')}>
                <MailboxNav
                  mailboxes={mailboxes}
                  mailboxId={mailboxId}
                  onMailbox={(id) => {
                    setTyped('')
                    update({ boite: id, fil: null, vue: null, q: null })
                  }}
                  current={choice}
                  onView={(nextView) => {
                    setTyped('')
                    update({ vue: nextView.view === 'inbox' ? null : viewParam(nextView), fil: null, q: null })
                  }}
                  labels={labels.data ?? []}
                  showToLink={canSeeFiles}
                  canCompose={sendable.length > 0}
                />
              </div>
              <section
                aria-label={t(`${I}.list.label`)}
                className={cn('flex min-h-0 flex-1 flex-col lg:border-r lg:border-border', threadId !== null && 'max-lg:hidden')}
              >
                {list}
              </section>
              {threadId !== null ? (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <MailThreadView
                    key={threadId}
                    threadId={threadId}
                    preview={preview}
                    markReadOnOpen={openedByRow !== threadId}
                    onBack={() => {
                      backTo.current = threadId
                      openThread(null)
                    }}
                    onNextThread={next ? () => openThread(next.id) : undefined}
                    onPrevThread={prev ? () => openThread(prev.id) : undefined}
                  />
                </div>
              ) : (
                <div className="hidden items-center justify-center p-6 text-sm text-muted-foreground lg:flex">{t(`${I}.thread.select`)}</div>
              )}
            </div>
          </ComposerHost>
        </EmailUiProvider>
      )}
    </div>
  )
}

import { ExternalLink } from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { toast } from '@/shared/ui/sonner'
import { communicationsErrorMessage } from '../../api/errors'
import { GMAIL_SEARCH_MIN, useGmailSearch, useOpenGmailThread } from '../../hooks/use-inbox'
import { gmailSearchUrl, senderLabel } from '../../lib/inbox-format'

const G = 'modules.communications.inbox.gmailSearch'

interface GmailSearchResultsProps {
  connectionId: string
  /** The mailbox's address, for Gmail's own search of older mail. */
  mailbox: string
  search: string
  /** The thread an opened hit became in the mirror. */
  onOpened: (threadId: string) => void
}

/**
 * « Dans Gmail » (CM-30): under a search's results, Gmail's own matches that the mirror does not
 * hold, within its 24 months (older mail, a word in a message's text, Gmail's operators). They are
 * read from Gmail and never stored (the section scrolls on its own, under the list): opening one copies that thread into the mirror (`gmail-search`
 * `open`), which then opens like any other. Older than 24 months: Gmail's own search, in a new tab.
 */
export function GmailSearchResults({ connectionId, mailbox, search, onOpened }: GmailSearchResultsProps) {
  const query = search.trim()
  const hits = useGmailSearch(connectionId, query)
  const open = useOpenGmailThread()
  if (query.length < GMAIL_SEARCH_MIN) return null

  const openHit = (gmailThreadId: string) =>
    open.mutate(
      { connectionId, gmailThreadId },
      {
        onSuccess: (threadId) => onOpened(threadId),
        onError: (error) => toast.error(communicationsErrorMessage(error, t(`${G}.openFailed`))),
      },
    )

  return (
    <section aria-labelledby="gmail-search-title" className="max-h-80 shrink-0 overflow-y-auto border-t border-border px-4 py-3">
      <h2 id="gmail-search-title" className="text-sm font-medium text-foreground">
        {t(`${G}.title`)}
      </h2>
      {hits.isPending ? (
        <p className="mt-1 text-sm text-muted-foreground" role="status">
          {t(`${G}.searching`)}
        </p>
      ) : hits.isError ? (
        <p className="mt-1 text-sm text-muted-foreground" role="status">
          {t(`${G}.failed`)}
        </p>
      ) : hits.data.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{t(`${G}.nothingMore`)}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border" aria-label={t(`${G}.title`)}>
          {hits.data.map((hit) => {
            const opening = open.isPending && open.variables?.gmailThreadId === hit.gmail_thread_id
            return (
              <li key={hit.gmail_thread_id}>
                <button
                  type="button"
                  disabled={open.isPending}
                  onClick={() => openHit(hit.gmail_thread_id)}
                  className="w-full py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{senderLabel(hit.from_name, hit.from_address)}</span>
                    <span className="tabular shrink-0 text-xs text-muted-foreground">
                      {opening ? t(`${G}.opening`) : hit.date ? formatClinicDateShort(hit.date) : ''}
                    </span>
                  </span>
                  <span className="block truncate text-sm text-foreground">{hit.subject.trim() || t('modules.communications.inbox.list.noSubject')}</span>
                  <span className="block truncate text-xs text-muted-foreground">{hit.snippet}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <a
        href={gmailSearchUrl(mailbox, query)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        {t(`${G}.older`)}
        <ExternalLink aria-hidden className="size-3" />
      </a>
    </section>
  )
}

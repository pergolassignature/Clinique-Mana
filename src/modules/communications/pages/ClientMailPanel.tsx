import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PenLine } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { initialContent } from '../lib/compose'
import { fileLabel, senderLabel } from '../lib/inbox-format'
import { ComposerHost } from '../components/composer/ComposerHost'
import { useClientThreads, useComposeContext } from '../hooks/use-composer'
import { useComposerLauncher } from '../hooks/use-composer-launcher'
import { useMailConnections } from '../hooks/use-mailboxes'

const P = 'modules.communications.clientPanel'

/**
 * Communications' panel in Clients' « Courriels » (slot `client.messages`, CM3): the Gmail threads
 * linked to the file (CM2b), newest first, each opening in « Courriels », and « Écrire un courriel »
 * from the clinic's mailbox, addressed to the file's own address and the relations that receive
 * its communications (Clients' `client_contacts_for`). The record's id comes from the route.
 */
export function ClientMailPanel() {
  const { id = '' } = useParams()
  const connections = useMailConnections()
  const mailboxes = useMemo(() => (connections.data ?? []).filter((m) => m.status === 'connected'), [connections.data])
  return (
    <ComposerHost mailboxes={mailboxes}>
      <PanelBody clientId={id} hasMailbox={mailboxes.length > 0} mailboxId={mailboxes[0]?.id ?? null} loadingMailboxes={connections.isPending} />
    </ComposerHost>
  )
}

function PanelBody({
  clientId,
  hasMailbox,
  mailboxId,
  loadingMailboxes,
}: {
  clientId: string
  hasMailbox: boolean
  mailboxId: string | null
  loadingMailboxes: boolean
}) {
  const { can } = useAccess()
  const threads = useClientThreads(clientId)
  const context = useComposeContext(can('clients.view') ? clientId : null)
  const composer = useComposerLauncher()
  const label = context.data ? fileLabel(context.data.client.client_number, context.data.client.display_name) : null
  const recipients = context.data?.recipients ?? []

  const write = () => {
    if (!mailboxId || !composer) return
    composer.open({
      kind: 'content',
      personKnown: true,
      fileLabel: label,
      content: initialContent({ connectionId: mailboxId, mode: 'new', clientId, to: recipients.map((r) => r.email) }),
    })
  }

  let list
  if (threads.isError && !threads.data) {
    list = <LoadError message={t(`${P}.loadError`)} retrying={threads.isFetching} onRetry={() => void threads.refetch()} />
  } else if (!threads.data) {
    list = <Loading />
  } else if (threads.data.length === 0) {
    list = <EmptyState title={t(`${P}.empty`)} />
  } else {
    list = (
      <ul aria-label={t(`${P}.title`)} className="divide-y divide-border-light rounded-md border border-border">
        {threads.data.map((thread) => (
          <li key={thread.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
            <Link
              to={`/courriels?boite=${thread.connection_id}&fil=${thread.id}`}
              className="min-w-0 flex-1 truncate font-medium text-link underline-offset-[3px] hover:underline"
            >
              {thread.subject?.trim() || t('modules.communications.inbox.list.noSubject')}
            </Link>
            <span className="text-xs text-muted-foreground">{senderLabel(thread.last_from_name, thread.last_from_address)}</span>
            <span className="tabular text-xs text-muted-foreground">
              {thread.message_count === 1 ? t(`${P}.messagesOne`) : t(`${P}.messagesOther`, { count: String(thread.message_count) })}
              {thread.unread_count > 0 && ` · ${t(`${P}.unread`)}`}
            </span>
            {thread.last_message_at && <span className="tabular text-xs text-muted-foreground">{formatClinicDateTime(thread.last_message_at)}</span>}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className="space-y-3" aria-labelledby="client-mail-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="client-mail-title" className="text-base font-semibold">
            {t(`${P}.title`)}
          </h2>
          <p className="text-sm text-muted-foreground">{t(`${P}.description`)}</p>
        </div>
        {hasMailbox && (
          <Button type="button" variant="outline" onClick={write} disabled={context.isPending} className="max-sm:h-11">
            <PenLine aria-hidden className="size-4" />
            {t(`${P}.write`)}
          </Button>
        )}
      </div>
      {!loadingMailboxes && !hasMailbox && <p className="text-sm text-muted-foreground">{t(`${P}.noMailbox`)}</p>}
      {hasMailbox && context.data && recipients.length === 0 && <p className="text-sm text-muted-foreground">{t(`${P}.noAddress`)}</p>}
      {list}
    </section>
  )
}

import { t } from '@/i18n'
import { HomeQueueCard } from '@/shared/components/HomeQueueCard'
import { useMailConnections } from '../hooks/use-mailboxes'

const H = 'modules.communications.home'

/**
 * Accueil « Courriels non lus » (L29, communications.inbox): the unread threads of each mailbox
 * the person reads (the clinic's shared ones and her own), each to that mailbox's « Non lus ».
 * The counts come with the mailboxes (`list_mail_connections`, the inbox's own query), never
 * polled; nothing when all is read or the read fails (the inbox still says it).
 */
export function MailHomeCard() {
  const { data } = useMailConnections()
  if (!data) return null
  return (
    <HomeQueueCard
      title={t(`${H}.title`)}
      items={data.filter((box) => box.status !== 'disconnected').map((box) => ({
        key: box.id,
        count: box.unread_count,
        label: t(`${H}.unreadIn`, { mailbox: box.email_address }),
        to: `/courriels?boite=${encodeURIComponent(box.id)}&vue=unread`,
      }))}
    />
  )
}

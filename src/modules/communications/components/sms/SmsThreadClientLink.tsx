import { t } from '@/i18n'
import { useSetSmsThreadLink, useSmsThreadLink } from '../../hooks/use-sms'
import { ClientLinkBox } from '../inbox/ThreadClientLink'

/**
 * A number's file in « Textos » (SM-15), for whoever holds `clients.view`: the file it is linked to
 * (found by the number, or chosen), « Détacher » and « Changer de dossier »; the files to review
 * when several hold the number; else « Rattacher à un dossier ». A person's choice is never undone
 * by a later text. The same box as a mail thread's (CM2b).
 */
export function SmsThreadClientLink({ phone }: { phone: string }) {
  const link = useSmsThreadLink(phone, true)
  const setLink = useSetSmsThreadLink(phone)
  if (link.isPending) return null
  if (link.isError && !link.data) return <p className="text-xs text-muted-foreground">{t('modules.communications.inbox.link.loadError')}</p>
  if (!link.data) return null
  return (
    <ClientLinkBox
      data={link.data}
      busy={setLink.isPending}
      onChoose={(clientId) => setLink.mutate(clientId)}
      autoLabel={t('modules.communications.sms.link.auto')}
    />
  )
}

import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { StatusDot } from '@/shared/ui/status-dot'
import type { ClientNumber } from '../api/sms'
import { ThreadView } from '../components/sms/ThreadView'
import { useClientSms } from '../hooks/use-sms'
import { formatPhone } from '../lib/phone'
import { smsConsentLabel } from '../lib/sms-status'

const P = 'modules.communications.clientSms'

/**
 * « Textos » in Clients' « Courriels » (slot `client.messages`, SM-16): the file's own numbers
 * (cellulaire, maison, travail) and the numbers linked to it, each with its consent and how many
 * texts; one opens its conversation below with the reply box (only while the consent is in force,
 * as in « Textos »). A first text to the file's own number links that number to the file. A text
 * goes through `sms-send`, refused while Communications is reserved for its testers (P3-40).
 */
export function ClientSmsPanel() {
  const { id = '' } = useParams()
  const numbers = useClientSms(id)
  const [open, setOpen] = useState<string | null>(null)
  const current = numbers.data?.find((n) => n.phone === open) ?? null

  let body
  if (numbers.isError && !numbers.data) {
    body = <LoadError message={t(`${P}.loadError`)} retrying={numbers.isFetching} onRetry={() => void numbers.refetch()} />
  } else if (!numbers.data) {
    body = <Loading />
  } else if (numbers.data.length === 0) {
    body = <EmptyState title={t(`${P}.empty`)} />
  } else {
    body = (
      <ul aria-label={t(`${P}.numbers`)} className="divide-y divide-border-light rounded-md border border-border">
        {numbers.data.map((n) => (
          <NumberRow key={n.phone} number={n} current={n.phone === open} onToggle={() => setOpen(open === n.phone ? null : n.phone)} />
        ))}
      </ul>
    )
  }

  return (
    <section className="space-y-3" aria-labelledby="client-sms-title">
      <div>
        <h2 id="client-sms-title" className="text-base font-semibold">
          {t(`${P}.title`)}
        </h2>
        <p className="text-sm text-muted-foreground">{t(`${P}.description`)}</p>
      </div>
      {body}
      {current && (
        <div className="flex max-h-[36rem] min-h-[22rem] flex-col overflow-hidden rounded-md border border-border bg-card">
          <ThreadView
            phone={current.phone}
            consent={current.consent}
            onBack={() => setOpen(null)}
            hideLink
            linkClientId={current.linkStatus === 'linked' ? null : id}
          />
        </div>
      )}
    </section>
  )
}

function NumberRow({ number: n, current, onToggle }: { number: ClientNumber; current: boolean; onToggle: () => void }) {
  const consent = smsConsentLabel(n.consent)
  return (
    <li>
      <button
        type="button"
        aria-expanded={current}
        aria-label={current ? t(`${P}.close`) : t(`${P}.open`, { phone: formatPhone(n.phone) })}
        onClick={onToggle}
        className={cn(
          'flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset max-sm:min-h-11',
          current && 'bg-muted',
        )}
      >
        <MessageSquare aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="tabular font-medium text-foreground">{formatPhone(n.phone)}</span>
        <span className="text-muted-foreground">{t(`${P}.kinds.${n.kind}`)}</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot tone={consent.tone} />
          {consent.label}
        </span>
        <span className="tabular ml-auto text-xs text-muted-foreground">
          {n.messageCount === 0
            ? t(`${P}.messagesNone`)
            : `${n.messageCount === 1 ? t('modules.communications.sms.threads.messagesOne') : t('modules.communications.sms.threads.messagesOther', { count: String(n.messageCount) })}${n.lastMessageAt ? ` · ${formatClinicDateShort(n.lastMessageAt)}` : ''}`}
        </span>
      </button>
    </li>
  )
}

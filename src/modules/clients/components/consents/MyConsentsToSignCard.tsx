import { useState } from 'react'
import { FileSignature } from 'lucide-react'
import { t } from '@/i18n'
import { EmbeddedSigning, type EmbeddedSigningLink } from '@/core/signing/components/EmbeddedSigning'
import { LoadError } from '@/shared/components/LoadState'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import type { ConsentSignature } from '../../api/my-consents'
import { useMyConsentSignatures, useRefreshMyConsentSignatures, useStartMyConsentSignature } from '../../hooks/use-my-consents'

const M = 'modules.clients.mine.consents'

/** What each state says, in plain French (« il faut toujours être clair »). */
function stateLabel(row: ConsentSignature): string {
  if (row.state === 'signed') return t(`${M}.states.signed`)
  if (row.state === 'ready') return t(`${M}.states.ready`)
  return t(`${M}.states.waitingClient`)
}

/**
 * « Consentements à signer » (CC-22), on « Mes clients »: the client consents the professional
 * assigned to the file must countersign. She signs in the app, after the client — the document
 * prints the client's answers, so nothing can be signed before the client has answered. A row
 * « En attente du client » is shown but cannot be signed yet.
 *
 * The signing link is a credential: it lives in this component's state only, never in the cache.
 * Nothing is shown when she has none, so the page is unchanged for a professional with no consent
 * waiting.
 */
export function MyConsentsToSignCard() {
  const signatures = useMyConsentSignatures()
  const start = useStartMyConsentSignature()
  const refresh = useRefreshMyConsentSignatures()
  const [signing, setSigning] = useState<{ link: EmbeddedSigningLink; title: string } | null>(null)

  const sign = (row: ConsentSignature) =>
    start.mutate(row.requestId, {
      onSuccess: (link) => {
        if (link) setSigning({ link, title: `${row.consentName} — ${row.clientName}` })
      },
    })

  if (signatures.isError && !signatures.data) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <LoadError message={t(`${M}.loadError`)} onRetry={() => void signatures.refetch()} retrying={signatures.isFetching} />
      </div>
    )
  }
  const rows = signatures.data
  if (!rows || rows.length === 0) return null

  return (
    <>
      <section aria-label={t(`${M}.title`)} className="space-y-3 rounded-lg border border-border bg-card p-4">
          <header className="space-y-1">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <FileSignature aria-hidden className="size-4 text-subtle" />
              {t(`${M}.title`)}
            </h2>
            <p className="text-sm text-muted-foreground">{t(`${M}.description`)}</p>
          </header>
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.requestId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-medium">{row.consentName}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {row.clientName}
                    {row.dueAt && <span className="ml-2">{t(`${M}.dueOn`, { date: formatClinicDateShort(row.dueAt) })}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={row.state === 'ready' ? 'info' : 'secondary'}>{stateLabel(row)}</Badge>
                  {row.state === 'ready' && (
                    <Button size="sm" onClick={() => sign(row)} disabled={start.isPending}>
                      {t(`${M}.sign`)}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
      </section>
      {signing && (
        <EmbeddedSigning
          link={signing.link}
          title={signing.title}
          onCompleted={() => {
            setSigning(null)
            void refresh()
          }}
          onClose={() => setSigning(null)}
        />
      )}
    </>
  )
}

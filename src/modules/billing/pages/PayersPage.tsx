import { useState } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatDateOnly } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/sonner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { PayerQueueGroup } from '../api/payers'
import type { SendResult } from '../api/queue'
import { usePayerQueue, usePreparePayerInvoices } from '../hooks/use-payers'
import { useSendInvoices } from '../hooks/use-queue'
import { formatCents } from '../lib/money'
import { cadenceLabel, organisationKindLabel } from '../lib/payers'

const P = 'modules.billing.payers'

/**
 * « Payeurs » (`/facturation/payeurs`, `billing.view`; actions with `billing.manage`, FP-3, FP-5):
 * per organisation (the clinic's IVAC first, then the PAE providers), the sessions whose share is
 * still to claim, by dossier (due now by the organisation's cadence, or later), the payer invoices
 * drafted and waiting to be sent, and what is unpaid. « Préparer les factures » drafts what is due;
 * « Facturer les PAE » (early April, to close the agreements' year) drafts every PAE share left.
 * Drafts are checked, then sent from here (« Tout envoyer ») or from their page.
 */
export function PayersPage() {
  usePageTitle(t(`${P}.title`))
  const { can } = useAccess()
  const manage = can('billing.manage')
  const queue = usePayerQueue()
  const [error, setError] = useState<string | null>(null)
  const [refusals, setRefusals] = useState<string[]>([])
  const [closing, setClosing] = useState(false)
  const prepare = usePreparePayerInvoices({ onErrorMessage: setError })
  const send = useSendInvoices({ onErrorMessage: setError })

  const groups = queue.data ?? []
  const due = groups.flatMap((g) => g.pending.filter((p) => p.due))
  const paeLeft = groups.filter((g) => g.organisation.kind === 'pae' && g.organisation.isActive && g.pending.length > 0)

  const runPrepare = (organisationIds: readonly (string | null)[], isClosing: boolean) => {
    if (prepare.isPending) return
    setError(null)
    setRefusals([])
    prepare.mutate(
      { organisationIds, closing: isClosing },
      {
        onSuccess: (made) => {
          setClosing(false)
          if (made.length === 0) toast.info(t(`${P}.preparedNone`))
          else toast.success(t(`${P}.prepared`, { count: String(made.length) }))
        },
      },
    )
  }
  const sendIds = (ids: string[], group: PayerQueueGroup) => {
    if (send.isPending || ids.length === 0) return
    setError(null)
    setRefusals([])
    send.mutate(ids, { onSuccess: (results) => report(results, group, setRefusals) })
  }

  let body
  if (queue.isError && !queue.data) body = <LoadError message={t(`${P}.loadError`)} onRetry={() => void queue.refetch()} retrying={queue.isFetching} />
  else if (!queue.data) body = <Loading />
  else if (groups.length === 0) body = <EmptyState title={t(`${P}.empty`)} />
  else {
    body = (
      <div className="space-y-4">
        {groups.map((g) => (
          <OrganisationCard
            key={g.organisation.id}
            group={g}
            manage={manage}
            busy={prepare.isPending || send.isPending}
            onPrepare={() => runPrepare([g.organisation.id], false)}
            onSend={(ids) => sendIds(ids, g)}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="max-w-content space-y-5">
      <PageHeader
        level={1}
        title={t(`${P}.title`)}
        description={t(`${P}.description`)}
        actions={
          manage && queue.data ? (
            <div className="flex flex-wrap gap-2">
              {paeLeft.length > 0 && (
                <Button type="button" variant="outline" onClick={() => setClosing(true)}>
                  {t(`${P}.closeYear`)}
                </Button>
              )}
              <Button type="button" aria-disabled={prepare.isPending || due.length === 0 || undefined} onClick={ignoreWhenInactive(prepare.isPending || due.length === 0, () => runPrepare([null], false))}>
                {t(`${P}.prepareAll`, { count: String(due.length) })}
              </Button>
            </div>
          ) : undefined
        }
      />
      {can('clients.view') && (
        <p className="text-sm">
          <Link to="/clients/payeurs-a-completer" className="text-primary underline-offset-2 hover:underline">
            {t(`${P}.toComplete`)}
          </Link>
        </p>
      )}
      {error && <RefusalAlert message={error} />}
      {refusals.length > 0 && (
        <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {refusals.map((r) => (
            <p key={r}>{r}</p>
          ))}
        </div>
      )}
      {body}
      <AlertDialog open={closing} onOpenChange={(open) => !open && !prepare.isPending && setClosing(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${P}.closeTitle`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${P}.closeBody`, { organisations: paeLeft.map((g) => g.organisation.name).join(', ') })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <Button
              type="button"
              aria-disabled={prepare.isPending || undefined}
              className={cn(softDisabledClasses)}
              onClick={ignoreWhenInactive(prepare.isPending, () => runPrepare(paeLeft.map((g) => g.organisation.id), true))}
            >
              {t(`${P}.closeConfirm`)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** What went (a toast) and what did not (each refusal, by dossier). */
function report(results: SendResult[], group: PayerQueueGroup, setRefusals: (r: string[]) => void) {
  const sent = results.filter((r) => r.error === null).length
  if (sent > 0) toast.success(t(`${P}.sent`, { count: String(sent) }))
  setRefusals(
    results
      .filter((r) => r.error !== null)
      .map((r) => t(`${P}.refused`, { client: group.drafts.find((d) => d.id === r.invoiceId)?.clientName ?? '', message: r.error ?? '' })),
  )
}

function OrganisationCard({
  group,
  manage,
  busy,
  onPrepare,
  onSend,
}: {
  group: PayerQueueGroup
  manage: boolean
  busy: boolean
  onPrepare: () => void
  onSend: (ids: string[]) => void
}) {
  const { organisation: o, pending, drafts, unpaid } = group
  const dueCount = pending.filter((p) => p.due).length
  const headingId = `payer-${o.id}`
  return (
    <section aria-labelledby={headingId} className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={headingId} className="text-base font-semibold">
            {o.name}
          </h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{organisationKindLabel(o.kind)}</span>
            <span>{t(`${P}.cadence`, { cadence: cadenceLabel(o.cadence) })}</span>
            {o.billingEmail ? <span>{t(`${P}.billingEmail`, { email: o.billingEmail })}</span> : <Badge variant="warning">{t(`${P}.noBillingEmail`)}</Badge>}
            {!o.isActive && <Badge variant="secondary">{t(`${P}.inactive`)}</Badge>}
          </p>
        </div>
        {manage && o.isActive && dueCount > 0 && (
          <Button type="button" size="sm" aria-disabled={busy || undefined} onClick={ignoreWhenInactive(busy, onPrepare)}>
            {t(`${P}.prepare`, { count: String(dueCount) })}
          </Button>
        )}
      </div>

      {pending.length === 0 && drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${P}.nothing`)}</p>
      ) : null}

      {pending.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`${P}.pendingTitle`)}</h3>
          <div className="rounded-md border border-border">
            <Table aria-label={t(`${P}.pendingLabel`, { organisation: o.name })} scrollLabel={t(`${P}.pendingLabel`, { organisation: o.name })}>
              <TableHeader>
                <TableRow className="[&>th]:whitespace-nowrap">
                  <TableHead>{t(`${P}.columns.client`)}</TableHead>
                  <TableHead>{t(`${P}.columns.fileNumber`)}</TableHead>
                  <TableHead className="text-right">{t(`${P}.columns.sessions`)}</TableHead>
                  <TableHead className="text-right">{t(`${P}.columns.amount`)}</TableHead>
                  <TableHead>{t(`${P}.columns.since`)}</TableHead>
                  <TableHead>{t(`${P}.columns.state`)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((p) => (
                  <TableRow key={p.clientPayerId}>
                    <TableCell className="font-medium">
                      <Link to={`/clients/${p.clientId}/visites-et-paiements`} className="text-primary underline-offset-2 hover:underline">
                        {p.clientName}
                      </Link>
                    </TableCell>
                    <TableCell>{p.fileNumber ?? t(`${P}.noFileNumber`)}</TableCell>
                    <TableCell className="tabular text-right">{p.sessions}</TableCell>
                    <TableCell className="tabular text-right">{formatCents(p.amountCents)}</TableCell>
                    <TableCell className="tabular whitespace-nowrap">{p.oldest ? formatDateOnly(p.oldest) : ''}</TableCell>
                    <TableCell>
                      {p.due ? (
                        <Badge variant="warning">{t(`${P}.due`)}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">{t(`${P}.later.${o.cadence}`)}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {drafts.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`${P}.draftsTitle`)}</h3>
            {manage && (
              <Button type="button" size="sm" aria-disabled={busy || undefined} onClick={ignoreWhenInactive(busy, () => onSend(drafts.map((d) => d.id)))}>
                {t(`${P}.sendAll`, { count: String(drafts.length) })}
              </Button>
            )}
          </div>
          <ul className="divide-y divide-border rounded-md border border-border" aria-label={t(`${P}.draftsLabel`, { organisation: o.name })}>
            {drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <Link to={`/facturation/factures/${d.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {d.clientName}
                  </Link>
                  <span className="text-muted-foreground">
                    {d.payerReference && ` · ${t(`${P}.fileNumber`, { number: d.payerReference })}`}
                    {` · ${t(`${P}.lines`, { count: String(d.lines) })}`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular font-medium">{formatCents(d.totalCents)}</span>
                  {manage && (
                    <Button type="button" size="sm" variant="outline" aria-disabled={busy || undefined} onClick={ignoreWhenInactive(busy, () => onSend([d.id]))}>
                      {t(`${P}.send`)}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unpaid.count > 0 && (
        <p className="text-sm">
          {t(`${P}.unpaid`, { count: String(unpaid.count), amount: formatCents(unpaid.balanceCents) })}{' '}
          <Link to="/facturation?vue=impayes" className="text-primary underline-offset-2 hover:underline">
            {t(`${P}.unpaidLink`)}
          </Link>
        </p>
      )}
    </section>
  )
}

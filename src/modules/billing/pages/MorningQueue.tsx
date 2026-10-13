import { useState } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { formatDateOnly } from '@/shared/lib/timezone'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { toast } from '@/shared/ui/sonner'
import type { HoldReason } from '../api/invoices'
import type { QueueRow, SendResult } from '../api/queue'
import { useHoldDraft, useMorningQueue, useReleaseDraft, useSendInvoices } from '../hooks/use-queue'
import { formatCents } from '../lib/money'

const Q = 'modules.billing.queue'

/** Holds the adjointe lifts herself (an agreement validated, a hold by hand); the others clear when fixed. */
const RELEASABLE: readonly HoldReason[] = ['special_agreement', 'client_agreement', 'manual']

/**
 * « File du matin » (R-56, BI-7): the drafts the night built from the sessions of the days before,
 * held ones first (an agreement to validate, an amount to type, a payer without an address, a
 * hold by hand). « Envoyer » finalises and sends one; « Tout envoyer » every ready one. A refusal
 * for one is said for that one, the others go.
 */
export function MorningQueue() {
  const { can } = useAccess()
  const manage = can('billing.manage')
  const queue = useMorningQueue()
  const [refusals, setRefusals] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const send = useSendInvoices({ onErrorMessage: setError })
  if (queue.isError && !queue.data) return <LoadError message={t(`${Q}.loadError`)} onRetry={() => void queue.refetch()} retrying={queue.isFetching} />
  if (!queue.data) return <Loading />
  const rows = queue.data
  const ready = rows.filter((r) => r.holdReason === null)
  const sendIds = (ids: string[]) => {
    if (send.isPending || ids.length === 0) return
    setError(null)
    setRefusals([])
    send.mutate(ids, { onSuccess: (results) => report(results, rows, setRefusals) })
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t(`${Q}.description`)}</p>
        {manage && ready.length > 0 && (
          <Button type="button" aria-disabled={send.isPending || undefined} onClick={() => sendIds(ready.map((r) => r.id))}>
            {t(`${Q}.sendAll`, { count: String(ready.length) })}
          </Button>
        )}
      </div>
      {error && <RefusalAlert message={error} />}
      {refusals.length > 0 && (
        <div role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          {refusals.map((r) => (
            <p key={r}>{r}</p>
          ))}
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState title={t(`${Q}.empty`)} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card" aria-label={t(`${Q}.label`)}>
          {rows.map((row) => (
            <QueueItem key={row.id} row={row} manage={manage} sending={send.isPending} onSend={() => sendIds([row.id])} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** What went (a toast) and what did not (each refusal, by dossier). */
function report(results: SendResult[], rows: QueueRow[], setRefusals: (r: string[]) => void) {
  const sent = results.filter((r) => r.error === null).length
  if (sent > 0) toast.success(t(`${Q}.sent`, { count: String(sent) }))
  setRefusals(
    results
      .filter((r) => r.error !== null)
      .map((r) => t(`${Q}.refused`, { client: rows.find((x) => x.id === r.invoiceId)?.clientName ?? '', message: r.error ?? '' })),
  )
}

function QueueItem({ row, manage, sending, onSend }: { row: QueueRow; manage: boolean; sending: boolean; onSend: () => void }) {
  const release = useReleaseDraft()
  const held = row.holdReason !== null
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5 text-sm">
      <div className="min-w-0 space-y-0.5">
        <p>
          <Link to={`/facturation/factures/${row.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
            {row.clientName}
          </Link>
          {row.serviceDate && <span className="text-muted-foreground"> · {t(`${Q}.session`, { date: formatDateOnly(row.serviceDate) })}</span>}
        </p>
        <p className="text-muted-foreground">
          {row.lines.map((l) => l.description).join(' · ')}
          {row.payerId !== row.clientId && ` · ${t(`${Q}.billedTo`, { name: row.payerName })}`}
        </p>
        {held && (
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant="warning">{t(`${Q}.holds.${row.holdReason as HoldReason}`)}</Badge>
            {row.holdNote && <span className="text-muted-foreground">{row.holdNote}</span>}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular font-medium">{formatCents(row.totalCents)}</span>
        {manage && held && RELEASABLE.includes(row.holdReason as HoldReason) && (
          <Button type="button" size="sm" variant="outline" aria-disabled={release.isPending || undefined} onClick={() => release.mutate(row.id)}>
            {row.holdReason === 'manual' ? t(`${Q}.release`) : t(`${Q}.validate`)}
          </Button>
        )}
        {manage && !held && <HoldButton invoiceId={row.id} />}
        {manage && (row.holdReason === null || row.holdReason === 'payer_missing') && (
          <Button type="button" size="sm" aria-disabled={sending || undefined} onClick={onSend}>
            {t(`${Q}.send`)}
          </Button>
        )}
        {(!manage || row.holdReason === 'price_missing') && (
          <Button asChild size="sm" variant="outline">
            <Link to={`/facturation/factures/${row.id}`}>{t(`${Q}.open`)}</Link>
          </Button>
        )}
      </div>
    </li>
  )
}

/** « Mettre en attente », with a note for the team. */
export function HoldButton({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const hold = useHoldDraft({ onErrorMessage: setError })
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t(`${Q}.hold`)}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t(`${Q}.holdTitle`)}</DialogTitle>
            <DialogDescription>{t(`${Q}.holdBody`)}</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (hold.isPending) return
              setError(null)
              hold.mutate({ invoiceId, note: note.trim() || null }, { onSuccess: () => setOpen(false) })
            }}
          >
            <FormField label={t(`${Q}.holdNote`)} width="full" error={error ?? undefined}>
              {(field) => <Input {...field} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
            </FormField>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('common.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" aria-disabled={hold.isPending || undefined}>
                {t(`${Q}.holdSubmit`)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { formatClinicDateFull, formatDateOnly } from '@/shared/lib/timezone'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/sonner'
import type { FeeDecision } from '../api/follow-up'
import { useDecideFee, useFeeDecisions, useOverdueInvoices } from '../hooks/use-follow-up'
import { formatCents } from '../lib/money'

const O = 'modules.billing.overdue'
const F = 'modules.billing.fees'

/**
 * « Impayés » (F3, BI-18): the unpaid invoices past their due date, the oldest first, with their
 * delay, balance and last reminder; « Rendez-vous refusés » when the dossier is blocked (R-58).
 */
export function OverdueInvoices() {
  const overdue = useOverdueInvoices()
  if (overdue.isError && !overdue.data) return <LoadError message={t(`${O}.loadError`)} onRetry={() => void overdue.refetch()} retrying={overdue.isFetching} />
  if (!overdue.data) return <Loading />
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t(`${O}.description`)}</p>
      {overdue.data.length === 0 ? (
        <EmptyState title={t(`${O}.empty`)} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full text-sm" aria-label={t(`${O}.label`)}>
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium">{t(`${O}.number`)}</th>
                <th className="px-3 py-2 font-medium">{t(`${O}.client`)}</th>
                <th className="px-3 py-2 font-medium">{t(`${O}.payer`)}</th>
                <th className="px-3 py-2 font-medium">{t(`${O}.due`)}</th>
                <th className="px-3 py-2 text-right font-medium">{t(`${O}.days`)}</th>
                <th className="px-3 py-2 text-right font-medium">{t(`${O}.balance`)}</th>
                <th className="px-3 py-2 font-medium">{t(`${O}.reminder`)}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {overdue.data.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <Link to={`/facturation/factures/${r.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {r.number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {r.clientName}
                    {r.blocking && (
                      <span className="block">
                        <Badge variant="error">{t(`${O}.blocking`)}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.payerName}
                    {!r.payerHasEmail && <span className="block text-xs">{t(`${O}.noEmail`)}</span>}
                  </td>
                  <td className="tabular px-3 py-2">{formatDateOnly(r.dueOn)}</td>
                  <td className="tabular px-3 py-2 text-right">{t(`${O}.daysValue`, { days: String(r.days) })}</td>
                  <td className="tabular px-3 py-2 text-right font-medium">{formatCents(r.balanceCents)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.lastStep === null ? t(`${O}.noReminder`) : t(`${O}.reminderValue`, { step: String(r.lastStep) })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * The cancellation fees (R-59, BI-16): the staff's « Frais d'annulation » tab (all professionals,
 * `mine` false) or the professional's own panel in « Mon agenda » (`mine`). Pending first; each
 * with « Appliquer les frais » (a draft in the morning queue) and « Ne pas facturer ».
 */
export function FeeDecisions({ mine = false }: { mine?: boolean }) {
  const { can } = useAccess()
  const fees = useFeeDecisions(mine ? 'pending' : null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const decide = useDecideFee({ onErrorMessage: setRefusal })
  const canDecide = mine ? can('billing.self') : can('billing.manage')
  if (fees.isError && !fees.data) return <LoadError message={t(`${F}.loadError`)} onRetry={() => void fees.refetch()} retrying={fees.isFetching} />
  if (!fees.data) return <Loading />
  const run = (fee: FeeDecision, apply: boolean) => {
    if (decide.isPending) return
    setRefusal(null)
    decide.mutate(
      { appointmentId: fee.appointmentId, apply, note: null },
      { onSuccess: () => toast.success(t(apply ? 'modules.billing.saved.feeApplied' : 'modules.billing.saved.feeWaived')) },
    )
  }
  return (
    <div className="space-y-3">
      {!mine && <p className="text-sm text-muted-foreground">{t(`${F}.description`)}</p>}
      {refusal && <RefusalAlert message={refusal} />}
      {fees.data.length === 0 ? (
        <EmptyState title={t(`${F}.empty`)} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm" aria-label={t(`${F}.label`)}>
          {fees.data.map((fee) => (
            <li key={fee.appointmentId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0 space-y-0.5">
                <p>
                  <span className="font-medium">{t(`${F}.kinds.${fee.kind}`)}</span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {t(`${F}.line`, {
                      date: fee.startsAt ? formatClinicDateFull(fee.startsAt) : '',
                      client: fee.clientName,
                      professional: fee.professionalName,
                    })}
                  </span>
                </p>
                {fee.feePercent !== null && (
                  <p className="tabular text-muted-foreground">
                    {fee.amountCents === null
                      ? t(`${F}.amountToType`, { percent: String(fee.feePercent).replace('.', ',') })
                      : t(`${F}.amount`, { percent: String(fee.feePercent).replace('.', ','), amount: formatCents(fee.amountCents) })}
                  </p>
                )}
                {fee.status !== 'pending' && (
                  <p className="flex flex-wrap items-center gap-2">
                    <Badge variant={fee.status === 'applied' ? 'success' : 'secondary'}>{t(`${F}.statuses.${fee.status}`)}</Badge>
                    {fee.decidedAs && <span className="text-muted-foreground">{t(`${F}.decidedAs.${fee.decidedAs}`)}</span>}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {fee.status === 'pending' && canDecide && (
                  <>
                    <Button type="button" size="sm" variant="outline" aria-disabled={decide.isPending || undefined} onClick={() => run(fee, false)}>
                      {t(`${F}.waive`)}
                    </Button>
                    <Button type="button" size="sm" aria-disabled={decide.isPending || undefined} onClick={() => run(fee, true)}>
                      {t(`${F}.apply`)}
                    </Button>
                  </>
                )}
                {!mine && fee.invoiceId && (
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/facturation/factures/${fee.invoiceId}`}>{t(`${F}.openInvoice`)}</Link>
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * « Mon agenda » (slot `agenda.mine`, under the agenda): the professional's fees to decide; nothing
 * when none. Accueil links here with `#frais`: the panel scrolls into view once it has loaded.
 */
export function MyFeesPanel() {
  const fees = useFeeDecisions('pending')
  const { hash } = useLocation()
  const section = useRef<HTMLElement>(null)
  const shown = !!fees.data && fees.data.length > 0
  useEffect(() => {
    if (shown && hash === '#frais') section.current?.scrollIntoView({ block: 'start' })
  }, [shown, hash])
  if (!shown) return null
  return (
    <section ref={section} id="frais" className="scroll-mt-4 space-y-2" aria-labelledby="my-fees">
      <h2 id="my-fees" className="text-base font-semibold">
        {t(`${F}.mineTitle`)}
      </h2>
      <p className="text-sm text-muted-foreground">{t(`${F}.mineDescription`)}</p>
      <FeeDecisions mine />
    </section>
  )
}

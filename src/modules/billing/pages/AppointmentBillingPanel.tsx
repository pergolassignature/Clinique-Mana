import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { useSlotTarget } from '@/core/modules/slots'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import type { AppointmentBilling } from '../api/invoices'
import { useAppointmentBilling, useCreateInvoice } from '../hooks/use-invoices'
import { formatCents, lineTypeLabel, paymentLabel, paymentVariant, statusLabel, statusVariant } from '../lib/money'

const A = 'modules.billing.appointment'
const FEE = 'modules.billing.audit.values.cancellation_fee_decisions'

/**
 * « Facturation » in Rendez-vous' appointment sheet (slot `appointment.sheet`, `billing.view`; parity
 * audit L10): the appointment's invoice lines (its session, its cancellation fee) with their
 * invoice's state and payment, each opening its invoice; not invoiced yet, the price
 * `create_invoice` would put (and the file-opening fee of a first invoice) and « Créer la facture »
 * (`billing.manage`); a late cancellation's or an absence's fee and its decision.
 */
export function AppointmentBillingPanel() {
  const target = useSlotTarget('appointment.sheet')
  const billing = useAppointmentBilling(target?.appointmentId ?? '')
  if (!target) return null
  if (billing.isError && !billing.data) {
    return <LoadError message={t(`${A}.loadError`)} retrying={billing.isFetching} onRetry={() => void billing.refetch()} />
  }
  if (billing.data === undefined) return <Loading />
  if (billing.data === null) return <p className="text-sm text-muted-foreground">{t(`${A}.none`)}</p>
  return <BillingBody b={billing.data} appointmentId={target.appointmentId} />
}

function BillingBody({ b, appointmentId }: { b: AppointmentBilling; appointmentId: string }) {
  const { can } = useAccess()
  const navigate = useNavigate()
  const [refusal, setRefusal] = useState<string | null>(null)
  const create = useCreateInvoice({ onErrorMessage: setRefusal })
  const live = b.lines.filter((l) => !l.credited)
  const credited = b.lines.filter((l) => l.credited)
  return (
    <section className="space-y-4" aria-label={t(`${A}.title`)}>
      {refusal && <RefusalAlert message={refusal} />}
      {live.length > 0 && (
        <ul className="space-y-2">
          {live.map((l) => (
            <li key={l.line_id} className="rounded-md border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to={`/facturation/factures/${l.invoice_id}`} className="font-medium text-link underline-offset-2 hover:underline">
                  {l.number ? t(`${A}.invoice`, { number: l.number }) : t(`${A}.draft`)}
                </Link>
                <span className="tabular">{formatCents(l.line_total_cents)}</span>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{lineTypeLabel(l.line_type)}</span>
                {l.client_name && <span>· {l.client_name}</span>}
                <Badge variant={statusVariant(l.status)}>{statusLabel(l.status)}</Badge>
                {l.status === 'issued' && <Badge variant={paymentVariant(l.payment_status)}>{paymentLabel(l.payment_status)}</Badge>}
                {l.status === 'issued' && l.payment_status !== 'paid' && (
                  <span>{t(`${A}.balance`, { amount: formatCents(l.invoice_total_cents - l.paid_cents) })}</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      {b.invoiceable && b.preview && (
        <div className="space-y-2 rounded-md border border-dashed border-border p-3 text-sm">
          <p className="font-medium text-foreground">{t(`${A}.notInvoiced`)}</p>
          {b.preview.missing || b.preview.total_cents === null ? (
            <p className="text-muted-foreground">{t(`${A}.priceMissing`)}</p>
          ) : (
            <p className="text-muted-foreground">
              {b.preview.tax_cents
                ? t(`${A}.priceTaxed`, { total: formatCents(b.preview.total_cents), taxes: formatCents(b.preview.tax_cents) })
                : t(`${A}.price`, { total: formatCents(b.preview.total_cents) })}
              {b.preview.variant_applied && ` ${t(`${A}.variant`)}`}
            </p>
          )}
          {b.preview.file_opening && (
            <p className="text-muted-foreground">
              {b.preview.file_opening.missing || b.preview.file_opening.total_cents === null
                ? t(`${A}.fileOpeningMissing`)
                : t(`${A}.fileOpening`, { total: formatCents(b.preview.file_opening.total_cents) })}
            </p>
          )}
          {can('billing.manage') && (
            <Button
              type="button"
              size="sm"
              aria-disabled={create.isPending || undefined}
              className={cn(softDisabledClasses, 'max-sm:h-11')}
              onClick={ignoreWhenInactive(create.isPending, () => {
                setRefusal(null)
                create.mutate([appointmentId], { onSuccess: (invoiceId) => navigate(`/facturation/factures/${invoiceId}`) })
              })}
            >
              {create.isPending ? t(`${A}.creating`) : t(`${A}.create`)}
            </Button>
          )}
        </div>
      )}
      {!b.invoiceable && live.length === 0 && !b.fee && <p className="text-sm text-muted-foreground">{t(`${A}.notInvoiceable`)}</p>}
      {b.fee && (
        <div className="space-y-1 rounded-md border border-border p-3 text-sm">
          <p className="font-medium text-foreground">
            {t(`${FEE}.kind.${b.fee.kind}`)} · {t(`${FEE}.status.${b.fee.status}`)}
          </p>
          {b.fee.amount_cents !== null && (
            <p className="text-muted-foreground">
              {b.fee.fee_percent !== null
                ? t(`${A}.feeAmountPercent`, { amount: formatCents(b.fee.amount_cents), percent: String(b.fee.fee_percent) })
                : t(`${A}.feeAmount`, { amount: formatCents(b.fee.amount_cents) })}
            </p>
          )}
          {b.fee.invoice_id && (
            <Link to={`/facturation/factures/${b.fee.invoice_id}`} className="text-link underline-offset-2 hover:underline">
              {b.fee.invoice_number ? t(`${A}.invoice`, { number: b.fee.invoice_number }) : t(`${A}.draft`)}
            </Link>
          )}
        </div>
      )}
      {credited.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t(`${A}.credited`, { numbers: credited.map((l) => l.number ?? t(`${A}.draft`)).join(', ') })}
        </p>
      )}
    </section>
  )
}

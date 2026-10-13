import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { formatClinicDateFull, formatClinicTime, formatDateOnly } from '@/shared/lib/timezone'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { useBillingNames, useClientBilling, useCreateInvoice, useCreateManualInvoice, useSetDefaultPayer } from '../hooks/use-invoices'
import { formatCents, statusLabel, statusVariant } from '../lib/money'

const C = 'modules.billing.client'

/**
 * Facturation's panel in Clients' « Visites et paiements » (slot `client.visits`, F1): « Facturé à
 * par défaut » (the client or a relation holding the right), the dossier's invoices, and the last
 * year's appointments not invoiced yet with « Créer la facture » (it opens the draft). Payments
 * come with F2. The record's id comes from the route (`/clients/:id/…`).
 */
export function ClientBillingPanel() {
  const { id = '' } = useParams()
  const { can } = useAccess()
  const navigate = useNavigate()
  const billing = useClientBilling(id)
  const names = useBillingNames()
  const [refusal, setRefusal] = useState<string | null>(null)
  const setDefault = useSetDefaultPayer({ onErrorMessage: setRefusal })
  const create = useCreateInvoice({ onErrorMessage: setRefusal })
  const createManual = useCreateManualInvoice({ onErrorMessage: setRefusal })
  const manage = can('billing.manage')
  if (billing.isError) return <LoadError message={t(`${C}.loadError`)} onRetry={() => void billing.refetch()} retrying={billing.isFetching} />
  if (!billing.data) return <Loading />
  const b = billing.data
  const open = (invoiceId: string) => navigate(`/facturation/factures/${invoiceId}`)
  return (
    <section className="space-y-4" aria-label={t(`${C}.title`)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-semibold">{t(`${C}.title`)}</h2>
        {manage && (
          <Button type="button" variant="outline" aria-disabled={createManual.isPending || undefined} onClick={() => createManual.mutate(id, { onSuccess: open })}>
            {t(`${C}.manual`)}
          </Button>
        )}
      </div>
      <FormField label={t(`${C}.defaultPayer`)} help={t(`${C}.defaultPayerHelp`)} width="md">
        {(field) => (
          <Select
            {...field}
            value={b.defaultPayerId}
            readOnly={!manage}
            onChange={(e) => {
              setRefusal(null)
              setDefault.mutate({ clientId: id, payerId: e.target.value })
            }}
          >
            {b.payerOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.isSelf ? t(`${C}.self`, { name: o.name }) : o.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {refusal && <RefusalAlert message={refusal} />}

      <div className="space-y-1.5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`${C}.toInvoice`, { count: String(b.toInvoice.length) })}</h3>
        {b.toInvoice.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${C}.nothingToInvoice`)}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm" aria-label={t(`${C}.toInvoiceList`)}>
            {b.toInvoice.map((a) => (
              <li key={a.appointmentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium">
                    {formatClinicDateFull(a.startsAt)}, {formatClinicTime(a.startsAt)}
                  </span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {names.data?.professionals.get(a.professionalId) ?? ''}
                    {a.serviceId && names.data?.services.get(a.serviceId) ? ` · ${names.data.services.get(a.serviceId)}` : ''}
                  </span>
                  {!a.firstClient && <span className="block text-xs text-muted-foreground">{t(`${C}.secondPerson`)}</span>}
                </span>
                {manage && a.firstClient && (
                  <Button
                    type="button"
                    size="sm"
                    aria-disabled={create.isPending || undefined}
                    onClick={() => {
                      if (create.isPending) return
                      setRefusal(null)
                      create.mutate([a.appointmentId], { onSuccess: open })
                    }}
                  >
                    {t(`${C}.create`)}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`${C}.invoices`)}</h3>
        {b.invoices.length === 0 ? (
          <EmptyState title={t(`${C}.noInvoice`)} />
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm" aria-label={t(`${C}.invoices`)}>
            {b.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <Link to={`/facturation/factures/${i.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {i.number ?? t(`${C}.draft`)}
                  </Link>
                  <span className="text-muted-foreground">
                    {i.issuedOn ? ` · ${formatDateOnly(i.issuedOn)}` : ''}
                    {i.payerId !== id ? ` · ${t(`${C}.billedTo`, { name: b.payerOptions.find((o) => o.id === i.payerId)?.name ?? '' })}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular">{formatCents(i.totalCents)}</span>
                  <Badge variant={statusVariant(i.status)}>{statusLabel(i.status)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

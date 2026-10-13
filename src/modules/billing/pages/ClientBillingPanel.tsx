import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import {
  formatClinicDateFull,
  formatClinicTime,
  formatDateOnly,
  getClinicDateString,
} from '@/shared/lib/timezone'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import { Textarea } from '@/shared/ui/textarea'
import type { ClientBilling } from '../api/invoices'
import { PdfLink } from '../components/documents'
import { ClientPayersCard } from './ClientPayersCard'
import { deliveryText } from '../lib/delivery'
import { useCreateStatement, useSetSpecialAgreement } from '../hooks/use-queue'
import {
  useBillingNames,
  useClientBilling,
  useCreateInvoice,
  useCreateManualInvoice,
  useSetDefaultPayer,
} from '../hooks/use-invoices'
import {
  formatCents,
  paymentLabel,
  paymentVariant,
  statusLabel,
  statusVariant,
} from '../lib/money'

const C = 'modules.billing.client'

/**
 * Facturation's panel in Clients' « Visites et paiements » (slot `client.visits`): « Facturé à par
 * défaut » (the client or a relation holding the right), the dossier's balance and « entente
 * particulière » (F2: its sessions stop in the morning queue), the last year's appointments not
 * invoiced yet with « Créer la facture » (it opens the draft), the dossier's invoices with their
 * payment state, its payments with their receipts, and its statements (« Relevés »). The
 * record's id comes from the route (`/clients/:id/…`).
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
  if (billing.isError)
    return (
      <LoadError
        message={t(`${C}.loadError`)}
        onRetry={() => void billing.refetch()}
        retrying={billing.isFetching}
      />
    )
  if (!billing.data) return <Loading />
  const b = billing.data
  const open = (invoiceId: string) =>
    navigate(`/facturation/factures/${invoiceId}`)
  return (
    <section className="space-y-4" aria-label={t(`${C}.title`)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base font-semibold">{t(`${C}.title`)}</h2>
        {manage && (
          <Button
            type="button"
            variant="outline"
            aria-disabled={createManual.isPending || undefined}
            onClick={() => createManual.mutate(id, { onSuccess: open })}
          >
            {t(`${C}.manual`)}
          </Button>
        )}
      </div>
      <FormField
        label={t(`${C}.defaultPayer`)}
        help={t(`${C}.defaultPayerHelp`)}
        width="md"
      >
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
      <p className="tabular text-sm font-medium">
        {t(`${C}.balance`, { amount: formatCents(b.balanceCents) })}
      </p>
      <AgreementCard
        key={b.specialAgreement?.note ?? ''}
        clientId={id}
        note={b.specialAgreement?.note ?? null}
        manage={manage}
      />
      <ClientPayersCard clientId={id} manage={manage} />

      <div className="space-y-1.5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t(`${C}.toInvoice`, { count: String(b.toInvoice.length) })}
        </h3>
        {b.toInvoice.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t(`${C}.nothingToInvoice`)}
          </p>
        ) : (
          <ul
            className="divide-y divide-border rounded-md border border-border bg-card text-sm"
            aria-label={t(`${C}.toInvoiceList`)}
          >
            {b.toInvoice.map((a) => (
              <li
                key={a.appointmentId}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span>
                  <span className="font-medium">
                    {formatClinicDateFull(a.startsAt)},{' '}
                    {formatClinicTime(a.startsAt)}
                  </span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {names.data?.professionals.get(a.professionalId) ?? ''}
                    {a.serviceId && names.data?.services.get(a.serviceId)
                      ? ` · ${names.data.services.get(a.serviceId)}`
                      : ''}
                  </span>
                  {!a.firstClient && (
                    <span className="block text-xs text-muted-foreground">
                      {t(`${C}.secondPerson`)}
                    </span>
                  )}
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
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t(`${C}.invoices`)}
        </h3>
        {b.invoices.length === 0 ? (
          <EmptyState title={t(`${C}.noInvoice`)} />
        ) : (
          <ul
            className="divide-y divide-border rounded-md border border-border bg-card text-sm"
            aria-label={t(`${C}.invoices`)}
          >
            {b.invoices.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span>
                  <Link
                    to={`/facturation/factures/${i.id}`}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {i.number ?? t(`${C}.draft`)}
                  </Link>
                  <span className="text-muted-foreground">
                    {i.issuedOn ? ` · ${formatDateOnly(i.issuedOn)}` : ''}
                    {i.payerKind === 'organisation'
                      ? ` · ${t(`${C}.billedTo`, { name: i.payerOrganisationName ?? '' })}`
                      : i.payerId !== id
                        ? ` · ${t(`${C}.billedTo`, { name: b.payerOptions.find((o) => o.id === i.payerId)?.name ?? '' })}`
                        : ''}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular">{formatCents(i.totalCents)}</span>
                  <Badge variant={statusVariant(i.status)}>
                    {statusLabel(i.status)}
                  </Badge>
                  {i.status === 'issued' && (
                    <Badge variant={paymentVariant(i.paymentStatus)}>
                      {paymentLabel(i.paymentStatus)}
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t(`${C}.payments`)}
        </h3>
        {b.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${C}.noPayment`)}</p>
        ) : (
          <ul
            className="divide-y divide-border rounded-md border border-border bg-card text-sm"
            aria-label={t(`${C}.payments`)}
          >
            {b.payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span className="tabular">
                  {t(`${C}.paymentLine`, {
                    amount: formatCents(p.amountCents),
                    date: formatDateOnly(p.paidOn),
                    mode: p.mode,
                    invoice: p.invoiceNumber ?? '',
                  })}
                </span>
                {p.receiptNumber && (
                  <PdfLink
                    fileId={p.receiptFileId}
                    label={t('modules.billing.invoice.payments.receipt', {
                      number: p.receiptNumber,
                    })}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Statements clientId={id} billing={b} manage={manage} />
    </section>
  )
}

const A = 'modules.billing.client.agreement'

/** The dossier's « entente particulière »: a note; its sessions stop in the morning queue for validation. */
function AgreementCard({
  clientId,
  note,
  manage,
}: {
  clientId: string
  note: string | null
  manage: boolean
}) {
  const [value, setValue] = useState(note ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = useSetSpecialAgreement({ onErrorMessage: setError })
  const dirty = value.trim() !== (note ?? '')
  if (!manage) {
    return (
      <div className="space-y-0.5 text-sm">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t(`${A}.title`)}
        </h3>
        <p>{note ?? t(`${A}.none`)}</p>
      </div>
    )
  }
  return (
    <form
      noValidate
      aria-label={t(`${A}.title`)}
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (save.isPending || !dirty) return
        const trimmed = value.trim()
        if (trimmed && (trimmed.length < 3 || trimmed.length > 500))
          return setError(t(`${A}.noteInvalid`))
        setError(null)
        save.mutate({ clientId, note: trimmed || null })
      }}
    >
      <FormField
        label={t(`${A}.title`)}
        help={t(`${A}.help`)}
        width="full"
        error={error ?? undefined}
      >
        {(field) => (
          <Textarea
            {...field}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={2}
            maxLength={500}
          />
        )}
      </FormField>
      <div className="flex flex-wrap gap-2">
        {dirty && (
          <Button
            type="submit"
            size="sm"
            variant="outline"
            aria-disabled={save.isPending || undefined}
          >
            {t(`${A}.save`)}
          </Button>
        )}
        {note && !dirty && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-disabled={save.isPending || undefined}
            onClick={() =>
              save.mutate(
                { clientId, note: null },
                { onSuccess: () => setValue('') }
              )
            }
          >
            {t(`${A}.end`)}
          </Button>
        )}
      </div>
    </form>
  )
}

const ST = 'modules.billing.client.statement'

/** « Relevés »: a year for one payer, prepared (stored) or sent; each one's PDF once ready. */
function Statements({
  clientId,
  billing,
  manage,
}: {
  clientId: string
  billing: ClientBilling
  manage: boolean
}) {
  const thisYear = Number(getClinicDateString(new Date()).slice(0, 4))
  const [year, setYear] = useState(String(thisYear))
  const [payer, setPayer] = useState(billing.defaultPayerId)
  const [error, setError] = useState<string | null>(null)
  const create = useCreateStatement({ onErrorMessage: setError })
  const make = (send: boolean) => {
    if (create.isPending) return
    setError(null)
    create.mutate(
      { clientId, year: Number(year), payerId: payer, send },
      { onSuccess: () => toast.success(t(`${ST}.made`)) }
    )
  }
  const payerName = (payerId: string) =>
    billing.payerOptions.find((o) => o.id === payerId)?.name ?? ''
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t(`${ST}.title`)}
      </h3>
      {manage && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t(`${ST}.help`)}</p>
          <div className="flex flex-wrap items-end gap-3">
            <FormField label={t(`${ST}.year`)} width="xs">
              {(field) => (
                <Input
                  {...field}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  inputMode="numeric"
                  maxLength={4}
                  className="tabular"
                />
              )}
            </FormField>
            <FormField label={t(`${ST}.payer`)} width="md">
              {(field) => (
                <Select
                  {...field}
                  value={payer}
                  onChange={(e) => setPayer(e.target.value)}
                >
                  {billing.payerOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <Button
              type="button"
              variant="outline"
              aria-disabled={create.isPending || undefined}
              onClick={() => make(false)}
            >
              {t(`${ST}.make`)}
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-disabled={create.isPending || undefined}
              onClick={() => make(true)}
            >
              {t(`${ST}.send`)}
            </Button>
          </div>
          {error && <RefusalAlert message={error} />}
        </div>
      )}
      {billing.statements.length > 0 && (
        <ul
          className="divide-y divide-border rounded-md border border-border bg-card text-sm"
          aria-label={t(`${ST}.list`)}
        >
          {billing.statements.map((st) => (
            <li
              key={st.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <span>
                <span className="font-medium">
                  {t(`${ST}.item`, { year: String(st.year) })}
                </span>
                <span className="text-muted-foreground">
                  {' · '}
                  {payerName(st.payerId)}
                  {deliveryText(st.deliveries[0])
                    ? ` · ${deliveryText(st.deliveries[0])}`
                    : ''}
                </span>
              </span>
              {st.pdfFileId ? (
                <PdfLink fileId={st.pdfFileId} label={t(`${ST}.download`)} />
              ) : (
                <span className="text-muted-foreground">
                  {t(`${ST}.preparing`)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

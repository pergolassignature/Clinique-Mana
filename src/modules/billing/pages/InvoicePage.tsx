import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { QboInvoiceStatus } from '../components/QboInvoiceStatus'
import { useAccess } from '@/core/access/access-context'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { formatDateOnly, getClinicDateString } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { usePageTitle } from '@/shared/lib/use-page-title'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import { Textarea } from '@/shared/ui/textarea'
import { DateField } from '@/shared/ui/date-field'
import type { InvoiceBundle, InvoiceLine, Payment } from '../api/invoices'
import { PdfLink, PreviewButton } from '../components/documents'
import { deliveryText } from '../lib/delivery'
import {
  useAddAdjustment,
  useDeleteDraft,
  useFinalizeInvoice,
  useInvoice,
  useIssueCreditNote,
  useRemoveLine,
  useSetInvoiceNotes,
  useSetInvoicePayer,
  useSetLinePrice,
} from '../hooks/use-invoices'
import { useRefundPayment } from '../hooks/use-follow-up'
import {
  useRecordPayment,
  useReleaseDraft,
  useResendDocument,
  useSendInvoices,
} from '../hooks/use-queue'
import {
  formatCents,
  lineTypeLabel,
  paymentLabel,
  paymentVariant,
  parseDollars,
  statusLabel,
  statusVariant,
} from '../lib/money'
import { HoldButton } from './MorningQueue'

const I = 'modules.billing.invoice'

/**
 * An invoice (`/facturation/factures/:id`): the dossier and « Facturé à » (chosen among the client
 * and the relations holding the right, a draft only), the lines with their taxes, the totals the
 * database computed, the notes. A draft takes adjustments, amounts to type and line removals, then
 * « Finaliser et envoyer » numbers it (`AAAA-N`) and sends its PDF to the payer (F2; « Finaliser
 * sans envoyer » keeps the email); « Aperçu PDF » renders it first. An issued invoice shows its
 * PDF, what its email did, its payments with their receipts (« Enregistrer un paiement »), and is
 * corrected only by a credit note (then a new invoice).
 */
export function InvoicePage() {
  const { id = '' } = useParams()
  const invoice = useInvoice(id)
  usePageTitle(invoice.data?.invoice.number ?? t(`${I}.draftTitle`))
  if (invoice.isError && !invoice.data)
    return (
      <LoadError
        message={t(`${I}.loadError`)}
        onRetry={() => void invoice.refetch()}
        retrying={invoice.isFetching}
      />
    )
  if (invoice.isPending) return <Loading />
  if (!invoice.data)
    return (
      <FullPageMessage
        role="status"
        title={t(`${I}.notFound`)}
        body={t(`${I}.notFoundBody`)}
      />
    )
  return <Invoice bundle={invoice.data} />
}

function Invoice({ bundle }: { bundle: InvoiceBundle }) {
  const { can } = useAccess()
  const { invoice, client, payer, payerOptions, lines, creditNote } = bundle
  const manage = can('billing.manage')
  const draft = invoice.status === 'draft' && manage
  const [refusal, setRefusal] = useState<string | null>(null)
  const feedback = { onErrorMessage: setRefusal }
  const setPayer = useSetInvoicePayer(feedback)
  const finalize = useFinalizeInvoice(feedback)
  const send = useSendInvoices(feedback)
  const release = useReleaseDraft(feedback)
  const resend = useResendDocument(feedback)
  const delivery = deliveryText(bundle.deliveries[0])
  return (
    <div className="space-y-5">
      <PageHeader
        level={1}
        title={
          invoice.number
            ? t(`${I}.title`, { number: invoice.number })
            : t(`${I}.draftTitle`)
        }
        description={
          invoice.issuedOn
            ? t(`${I}.issuedOn`, { date: formatDateOnly(invoice.issuedOn) })
            : t(`${I}.draftDescription`)
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {draft && <DeleteDraft invoiceId={invoice.id} />}
            {invoice.status === 'draft' && (
              <PreviewButton kind="invoice" id={invoice.id} />
            )}
            {draft &&
              invoice.queueDay !== null &&
              invoice.holdReason === null && (
                <HoldButton invoiceId={invoice.id} />
              )}
            {draft && (
              <Button
                type="button"
                variant="outline"
                aria-disabled={finalize.isPending || undefined}
                onClick={() => {
                  if (finalize.isPending) return
                  setRefusal(null)
                  finalize.mutate(invoice.id, {
                    onSuccess: (number) =>
                      toast.success(t(`${I}.finalized`, { number })),
                  })
                }}
              >
                {t(`${I}.finalizeOnly`)}
              </Button>
            )}
            {draft && (
              <Button
                type="button"
                aria-disabled={send.isPending || undefined}
                onClick={() => {
                  if (send.isPending) return
                  setRefusal(null)
                  send.mutate([invoice.id], {
                    onSuccess: ([result]) => {
                      if (result?.error) setRefusal(result.error)
                      else if (result?.number)
                        toast.success(
                          t(`${I}.sentOne`, { number: result.number })
                        )
                    },
                  })
                }}
              >
                {t(`${I}.sendFinalize`)}
              </Button>
            )}
            {manage && invoice.status !== 'draft' && (
              <Button
                type="button"
                variant="outline"
                aria-disabled={resend.isPending || undefined}
                onClick={() =>
                  resend.mutate({ kind: 'invoice', id: invoice.id })
                }
              >
                {t(`${I}.resend`)}
              </Button>
            )}
            {manage && invoice.status === 'issued' && (
              <CreditNoteButton invoiceId={invoice.id} />
            )}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(invoice.status)}>
          {statusLabel(invoice.status)}
        </Badge>
        {invoice.status === 'issued' && (
          <Badge variant={paymentVariant(invoice.paymentStatus)}>
            {paymentLabel(invoice.paymentStatus)}
          </Badge>
        )}
        {invoice.taxExempt && (
          <Badge variant="outline">{t(`${I}.taxExempt`)}</Badge>
        )}
        {/* FQ part 2: the invoice's state in QuickBooks. */}
        {invoice.status !== 'draft' && (
          <QboInvoiceStatus invoiceId={invoice.id} />
        )}
      </div>
      {refusal && <RefusalAlert message={refusal} />}
      {invoice.status === 'draft' && invoice.holdNow !== null && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm"
        >
          <span>
            {t(`${I}.held`, {
              reason: t(`modules.billing.queue.holds.${invoice.holdNow}`),
            })}
            {invoice.holdNote && (
              <span className="block text-muted-foreground">
                {invoice.holdNote}
              </span>
            )}
          </span>
          {manage && invoice.holdReason !== null && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-disabled={release.isPending || undefined}
              onClick={() => release.mutate(invoice.id)}
            >
              {t(`${I}.release`)}
            </Button>
          )}
        </div>
      )}
      {invoice.status === 'draft' &&
        !invoice.payerHasEmail &&
        invoice.holdNow !== 'payer_missing' && (
          <p className="text-sm text-muted-foreground">{t(`${I}.noEmail`)}</p>
        )}
      {invoice.status !== 'draft' && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <PdfLink fileId={invoice.pdfFileId} label={t(`${I}.download`)} />
          {delivery && (
            <span className="text-muted-foreground">{delivery}</span>
          )}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 text-sm">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(`${I}.client`)}
          </h2>
          <Link
            to={`/clients/${client.id}`}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {client.name}
          </Link>
          {client.clientNumber !== null && (
            <p className="text-muted-foreground">
              {t(`${I}.clientNumber`, { number: String(client.clientNumber) })}
            </p>
          )}
        </div>
        <div className="space-y-1 text-sm">
          {draft && invoice.payerKind !== 'organisation' ? (
            <FormField
              label={t(`${I}.payer`)}
              help={t(`${I}.payerHelp`)}
              width="md"
            >
              {(field) => (
                <Select
                  {...field}
                  value={invoice.payerId}
                  onChange={(e) => {
                    setRefusal(null)
                    setPayer.mutate({
                      invoiceId: invoice.id,
                      payerId: e.target.value,
                    })
                  }}
                >
                  {payerOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.isSelf
                        ? t(`${I}.payerSelf`, { name: o.name })
                        : o.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : (
            <>
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(`${I}.payer`)}
              </h2>
              <p className="font-medium">
                {invoice.payerKind !== 'organisation' && payer.id === client.id
                  ? t(`${I}.payerSelf`, { name: payer.name })
                  : payer.name}
              </p>
              {invoice.payerReference && (
                <p className="text-muted-foreground">
                  {t(`${I}.payerReference`, { number: invoice.payerReference })}
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <Lines lines={lines} draft={draft} setRefusal={setRefusal} />
      {draft && <AdjustmentForm invoiceId={invoice.id} />}
      <Totals bundle={bundle} />
      {creditNote && (
        <section className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium">
            {t(`${I}.creditNote`, {
              number: creditNote.number,
              date: formatDateOnly(creditNote.issuedOn),
            })}
          </p>
          <p className="text-muted-foreground">{creditNote.reason}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <PdfLink
              fileId={creditNote.pdfFileId}
              label={t(`${I}.downloadCreditNote`)}
            />
            {deliveryText(creditNote.deliveries[0]) && (
              <span className="text-muted-foreground">
                {deliveryText(creditNote.deliveries[0])}
              </span>
            )}
          </div>
        </section>
      )}
      {invoice.status !== 'draft' && (
        <Payments bundle={bundle} manage={manage} />
      )}
      {manage && (
        <Notes
          key={`${invoice.notesClient}|${invoice.notesInternal}`}
          bundle={bundle}
        />
      )}
    </div>
  )
}

function Lines({
  lines,
  draft,
  setRefusal,
}: {
  lines: readonly InvoiceLine[]
  draft: boolean
  setRefusal: (m: string | null) => void
}) {
  const remove = useRemoveLine({ onErrorMessage: setRefusal })
  if (lines.length === 0)
    return <p className="text-sm text-muted-foreground">{t(`${I}.noLines`)}</p>
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-sm" aria-label={t(`${I}.lines`)}>
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-3 py-2 font-medium">{t(`${I}.description`)}</th>
            <th className="px-3 py-2 text-right font-medium">
              {t(`${I}.quantity`)}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {t(`${I}.unitPrice`)}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {t(`${I}.taxes`)}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {t(`${I}.lineTotal`)}
            </th>
            {draft && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-2">
                <span className="block">{l.description}</span>
                <span className="text-xs text-muted-foreground">
                  {lineTypeLabel(l.lineType)}
                  {l.serviceCode !== null && ` · ${l.serviceCode}`}
                </span>
              </td>
              <td className="tabular px-3 py-2 text-right">{l.quantity}</td>
              <td className="tabular px-3 py-2 text-right">
                {l.unitPriceCents === null ? (
                  draft ? (
                    <PriceInput line={l} setRefusal={setRefusal} />
                  ) : (
                    '—'
                  )
                ) : (
                  formatCents(l.unitPriceCents)
                )}
              </td>
              <td className="tabular px-3 py-2 text-right text-muted-foreground">
                {l.taxRule === 'taxable'
                  ? formatCents(l.gstCents + l.qstCents)
                  : t(`${I}.untaxed`)}
              </td>
              <td className="tabular px-3 py-2 text-right font-medium">
                {formatCents(l.totalCents)}
              </td>
              {draft && (
                <td className="px-3 py-2 text-right">
                  {/* A payer's share is computed (FP-2): it follows its session, never removed by hand. */}
                  {l.lineType !== 'payer_share' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t(`${I}.removeLine`, {
                        description: l.description,
                      })}
                      onClick={() => remove.mutate(l.id)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The amount of a « montant saisi à la facture » line. */
function PriceInput({
  line,
  setRefusal,
}: {
  line: InvoiceLine
  setRefusal: (m: string | null) => void
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = useSetLinePrice({ onErrorMessage: setRefusal })
  useUnsavedChanges(value.trim() !== '')
  return (
    <form
      noValidate
      className="flex items-center justify-end gap-1"
      onSubmit={(event) => {
        event.preventDefault()
        const cents = parseDollars(value)
        if (cents === null) return setError(t(`${I}.amountInvalid`))
        setError(null)
        save.mutate(
          { lineId: line.id, cents },
          { onSuccess: () => setValue('') }
        )
      }}
    >
      <Input
        aria-label={t(`${I}.amountFor`, { description: line.description })}
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode="decimal"
        className="tabular h-8 w-24 text-right"
        placeholder={t(`${I}.amountToType`)}
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        aria-disabled={save.isPending || undefined}
      >
        {t(`${I}.amountSave`)}
      </Button>
    </form>
  )
}

function AdjustmentForm({ invoiceId }: { invoiceId: string }) {
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [amount, setAmount] = useState('')
  const [taxable, setTaxable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const add = useAddAdjustment({ onErrorMessage: setError })
  useUnsavedChanges(Boolean(description.trim() || amount.trim()))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const cents = parseDollars(amount)
    const qty = Number(quantity.replace(',', '.'))
    if (!description.trim())
      return setError(t(`${I}.adjustment.descriptionRequired`))
    if (cents === null) return setError(t(`${I}.amountInvalid`))
    if (!Number.isFinite(qty) || qty <= 0)
      return setError(t(`${I}.adjustment.quantityInvalid`))
    setError(null)
    add.mutate(
      {
        invoiceId,
        description: description.trim(),
        quantity: qty,
        unitPriceCents: cents,
        taxable,
      },
      {
        onSuccess: () => {
          setDescription('')
          setQuantity('1')
          setAmount('')
          setTaxable(false)
        },
      }
    )
  }
  return (
    <form
      noValidate
      onSubmit={submit}
      className="space-y-3 rounded-md border border-border p-3"
      aria-label={t(`${I}.adjustment.title`)}
    >
      <h2 className="text-sm font-medium">{t(`${I}.adjustment.title`)}</h2>
      <FormRow>
        <FormField
          label={t(`${I}.adjustment.description`)}
          width="full"
          required
        >
          {(field) => (
            <Input
              {...field}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
            />
          )}
        </FormField>
        <FormField label={t(`${I}.quantity`)} width="xs">
          {(field) => (
            <Input
              {...field}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              className="tabular"
            />
          )}
        </FormField>
        <FormField label={t(`${I}.unitPrice`)} width="sm" required>
          {(field) => (
            <Input
              {...field}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="tabular"
            />
          )}
        </FormField>
      </FormRow>
      <CheckboxField
        label={t(`${I}.adjustment.taxable`)}
        help={t(`${I}.adjustment.taxableHelp`)}
        checked={taxable}
        onCheckedChange={setTaxable}
      />
      {error && <RefusalAlert message={error} />}
      <Button
        type="submit"
        variant="outline"
        aria-disabled={add.isPending || undefined}
      >
        {t(`${I}.adjustment.add`)}
      </Button>
    </form>
  )
}

function Totals({ bundle }: { bundle: InvoiceBundle }) {
  const { invoice } = bundle
  const percent = (rate: number) =>
    `${new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 3 }).format(rate * 100)}\u00A0%`
  return (
    <dl
      className="ml-auto w-full max-w-xs space-y-1 text-sm"
      aria-label={t(`${I}.totals`)}
    >
      <div className="flex justify-between">
        <dt className="text-muted-foreground">{t(`${I}.subtotal`)}</dt>
        <dd className="tabular">{formatCents(invoice.subtotalCents)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">
          {t(`${I}.gst`, { rate: percent(invoice.gstRate) })}
        </dt>
        <dd className="tabular">{formatCents(invoice.gstCents)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">
          {t(`${I}.qst`, { rate: percent(invoice.qstRate) })}
        </dt>
        <dd className="tabular">{formatCents(invoice.qstCents)}</dd>
      </div>
      <div className="flex justify-between border-t border-border pt-1 font-semibold">
        <dt>{t(`${I}.total`)}</dt>
        <dd className="tabular">{formatCents(invoice.totalCents)}</dd>
      </div>
    </dl>
  )
}

const P = 'modules.billing.invoice.payments'

/** The invoice's payments and their receipts; « Enregistrer un paiement » while a balance is left. */
function Payments({
  bundle,
  manage,
}: {
  bundle: InvoiceBundle
  manage: boolean
}) {
  const { invoice, payments } = bundle
  const balance = invoice.totalCents - invoice.paidCents
  return (
    <section className="space-y-2" aria-labelledby="invoice-payments">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="invoice-payments" className="text-base font-semibold">
          {t(`${P}.title`)}
        </h2>
        <p className="tabular text-sm">
          {t(`${P}.paid`, { amount: formatCents(invoice.paidCents) })} ·{' '}
          {t(`${P}.balance`, { amount: formatCents(balance) })}
        </p>
      </div>
      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${P}.none`)}</p>
      ) : (
        <ul
          className="divide-y divide-border rounded-md border border-border bg-card text-sm"
          aria-label={t(`${P}.list`)}
        >
          {payments.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <span>
                <span className="tabular font-medium">
                  {formatCents(p.amountCents)}
                </span>
                <span className="text-muted-foreground">
                  {' · '}
                  {formatDateOnly(p.paidOn)} · {p.mode}
                  {p.reference ? ` · ${p.reference}` : ''}
                </span>
                {p.note && <span className="block text-xs text-muted-foreground">{t(`${P}.noteLine`, { note: p.note })}</span>}
                {p.receiptNumber && (
                  <span className="block text-xs text-muted-foreground">
                    {t(`${P}.receipt`, { number: p.receiptNumber })}
                    {deliveryText(p.receiptDeliveries[0])
                      ? ` · ${deliveryText(p.receiptDeliveries[0])}`
                      : ''}
                  </span>
                )}
                {p.refunds.map((r) => (
                  <span
                    key={r.id}
                    className="block text-xs text-muted-foreground"
                  >
                    {t(
                      r.status === 'recorded'
                        ? `${P}.refundLine`
                        : r.status === 'pending_provider'
                          ? `${P}.refundPending`
                          : `${P}.refundFailed`,
                      {
                        amount: formatCents(r.amountCents),
                        reason: r.reason,
                      }
                    )}
                  </span>
                ))}
              </span>
              <span className="flex flex-wrap items-center gap-3">
                {p.receiptNumber && (
                  <PdfLink
                    fileId={p.receiptFileId}
                    label={t(`${P}.receiptPdf`, { number: p.receiptNumber })}
                  />
                )}
                {manage &&
                  invoice.status === 'issued' &&
                  p.refundableCents > 0 && <RefundButton payment={p} />}
              </span>
            </li>
          ))}
        </ul>
      )}
      {manage && invoice.status === 'issued' && balance > 0 && (
        <PaymentForm key={balance} bundle={bundle} balance={balance} />
      )}
      {bundle.reminders.length > 0 && (
        <div className="space-y-1 text-sm">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(`${R}.title`)}
          </h3>
          <ul className="space-y-0.5 text-muted-foreground">
            {bundle.reminders.map((m) => (
              <li key={m.step}>
                {m.sent
                  ? t(`${R}.step`, {
                      step: String(m.step),
                      date: formatDateOnly(m.runOn),
                    })
                  : t(`${R}.stepMissed`, { step: String(m.step) })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

const R = 'modules.billing.invoice.reminders'

/** « Rembourser » a payment: an amount (what is left of it by default) and a reason. */
function RefundButton({ payment }: { payment: Payment }) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(
    (payment.refundableCents / 100).toFixed(2).replace('.', ',')
  )
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const refund = useRefundPayment({ onErrorMessage: setError })
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        {t(`${P}.refund`)}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t(`${P}.refundTitle`)}</DialogTitle>
            <DialogDescription>{t(`${P}.refundBody`)}</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (refund.isPending) return
              const cents = parseDollars(amount)
              if (cents === null) return setError(t(`${I}.amountInvalid`))
              if (reason.trim().length < 3)
                return setError(t(`${P}.reasonInvalid`))
              setError(null)
              refund.mutate(
                {
                  paymentId: payment.id,
                  amountCents: cents,
                  reason: reason.trim(),
                  modeCode: payment.modeCode,
                },
                { onSuccess: () => setOpen(false) }
              )
            }}
          >
            <FormField
              label={t(`${P}.refundAmount`)}
              help={t(`${P}.refundAmountHelp`, {
                amount: formatCents(payment.refundableCents),
              })}
              width="sm"
              required
            >
              {(field) => (
                <Input
                  {...field}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  className="tabular"
                />
              )}
            </FormField>
            <FormField
              label={t(`${P}.refundReason`)}
              width="full"
              required
              error={error ?? undefined}
            >
              {(field) => (
                <Input
                  {...field}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                />
              )}
            </FormField>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('common.cancel')}
                </Button>
              </DialogClose>
              <Button
                type="submit"
                aria-disabled={refund.isPending || undefined}
              >
                {t(`${P}.refundSubmit`)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function PaymentForm({
  bundle,
  balance,
}: {
  bundle: InvoiceBundle
  balance: number
}) {
  const today = getClinicDateString(new Date())
  const [mode, setMode] = useState(bundle.paymentModes[0]?.code ?? '')
  const [amount, setAmount] = useState(
    (balance / 100).toFixed(2).replace('.', ',')
  )
  const [paidOn, setPaidOn] = useState(today)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const record = useRecordPayment({ onErrorMessage: setError })
  return (
    <form
      noValidate
      aria-label={t(`${P}.add`)}
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (record.isPending) return
        const cents = parseDollars(amount)
        if (cents === null) return setError(t(`${I}.amountInvalid`))
        if (!paidOn) return setError(t(`${P}.dateInvalid`))
        setError(null)
        record.mutate({
          invoiceId: bundle.invoice.id,
          modeCode: mode,
          amountCents: cents,
          paidOn,
          reference: reference.trim() || null,
          note: note.trim() || null,
        })
      }}
    >
      <h3 className="text-sm font-medium">{t(`${P}.add`)}</h3>
      <FormRow>
        <FormField label={t(`${P}.mode`)} width="md" required>
          {(field) => (
            <Select
              {...field}
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              {bundle.paymentModes.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField
          label={t(`${P}.amount`)}
          help={t(`${P}.amountHelp`)}
          width="sm"
          required
        >
          {(field) => (
            <Input
              {...field}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="tabular"
            />
          )}
        </FormField>
        <FormField label={t(`${P}.paidOn`)} width="sm" required>
          {(field) => (
            <DateField {...field} value={paidOn} max={today} onChange={setPaidOn} />
          )}
        </FormField>
      </FormRow>
      <FormField
        label={t(`${P}.reference`)}
        help={t(`${P}.referenceHelp`)}
        width="md"
      >
        {(field) => (
          <Input
            {...field}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={100}
          />
        )}
      </FormField>
      <FormField label={t(`${P}.note`)} help={t(`${P}.noteHelp`)} width="full">
        {(field) => (
          <Textarea
            {...field}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
          />
        )}
      </FormField>
      {error && <RefusalAlert message={error} />}
      <Button type="submit" aria-disabled={record.isPending || undefined}>
        {t(`${P}.submit`)}
      </Button>
    </form>
  )
}

function Notes({ bundle }: { bundle: InvoiceBundle }) {
  const { invoice } = bundle
  const [client, setClient] = useState(invoice.notesClient ?? '')
  const [internal, setInternal] = useState(invoice.notesInternal ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = useSetInvoiceNotes({ onErrorMessage: setError })
  const dirty =
    client !== (invoice.notesClient ?? '') ||
    internal !== (invoice.notesInternal ?? '')
  useUnsavedChanges(dirty)
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!dirty || save.isPending) return
        setError(null)
        save.mutate({
          invoiceId: invoice.id,
          notesClient: client.trim() || null,
          notesInternal: internal.trim() || null,
        })
      }}
    >
      <FormRow>
        <FormField
          label={t(`${I}.notesClient`)}
          width="full"
          help={
            invoice.status === 'draft'
              ? t(`${I}.notesClientHelp`)
              : t(`${I}.notesClientFixed`)
          }
        >
          {(field) => (
            <Textarea
              {...field}
              value={client}
              onChange={(e) => setClient(e.target.value)}
              rows={2}
              maxLength={2000}
              readOnly={invoice.status !== 'draft'}
            />
          )}
        </FormField>
        <FormField
          label={t(`${I}.notesInternal`)}
          width="full"
          help={t(`${I}.notesInternalHelp`)}
        >
          {(field) => (
            <Textarea
              {...field}
              value={internal}
              onChange={(e) => setInternal(e.target.value)}
              rows={2}
              maxLength={5000}
            />
          )}
        </FormField>
      </FormRow>
      {error && <RefusalAlert message={error} />}
      {dirty && (
        <Button
          type="submit"
          variant="outline"
          aria-disabled={save.isPending || undefined}
        >
          {t(`${I}.notesSave`)}
        </Button>
      )}
    </form>
  )
}

function DeleteDraft({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const remove = useDeleteDraft()
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t(`${I}.delete`)}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${I}.deleteTitle`)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(`${I}.deleteBody`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                remove.mutate(invoiceId, {
                  onSuccess: () => navigate('/facturation', { replace: true }),
                })
              }
            >
              {t(`${I}.delete`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function CreditNoteButton({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const credit = useIssueCreditNote({ onErrorMessage: setError })
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        {t(`${I}.credit`)}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t(`${I}.creditTitle`)}</DialogTitle>
            <DialogDescription>{t(`${I}.creditBody`)}</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (credit.isPending) return
              setError(null)
              credit.mutate(
                { invoiceId, reason: reason.trim() },
                { onSuccess: () => setOpen(false) }
              )
            }}
          >
            <FormField
              label={t(`${I}.creditReason`)}
              width="full"
              required
              error={error ?? undefined}
            >
              {(field) => (
                <Input
                  {...field}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                />
              )}
            </FormField>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('common.cancel')}
                </Button>
              </DialogClose>
              <Button
                type="submit"
                aria-disabled={credit.isPending || undefined}
              >
                {t(`${I}.creditSubmit`)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

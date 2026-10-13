import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { formatDateOnly } from '@/shared/lib/timezone'
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
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import { Textarea } from '@/shared/ui/textarea'
import type { InvoiceBundle, InvoiceLine } from '../api/invoices'
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
import { formatCents, lineTypeLabel, parseDollars, statusLabel, statusVariant } from '../lib/money'

const I = 'modules.billing.invoice'

/**
 * An invoice (`/facturation/factures/:id`, F1): the dossier and « Facturé à » (chosen among the
 * client and the relations holding the right, a draft only), the lines with their taxes, the
 * totals the database computed, the notes. A draft takes adjustments, amounts to type and line
 * removals, then « Finaliser » numbers it (`AAAA-N`); an issued invoice is corrected only by a
 * credit note (then a new invoice).
 */
export function InvoicePage() {
  const { id = '' } = useParams()
  const invoice = useInvoice(id)
  usePageTitle(invoice.data?.invoice.number ?? t(`${I}.draftTitle`))
  if (invoice.isError && !invoice.data) return <LoadError message={t(`${I}.loadError`)} onRetry={() => void invoice.refetch()} retrying={invoice.isFetching} />
  if (invoice.isPending) return <Loading />
  if (!invoice.data) return <FullPageMessage role="status" title={t(`${I}.notFound`)} body={t(`${I}.notFoundBody`)} />
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
  return (
    <div className="space-y-5">
      <PageHeader
        level={1}
        title={invoice.number ? t(`${I}.title`, { number: invoice.number }) : t(`${I}.draftTitle`)}
        description={invoice.issuedOn ? t(`${I}.issuedOn`, { date: formatDateOnly(invoice.issuedOn) }) : t(`${I}.draftDescription`)}
        actions={
          <div className="flex flex-wrap gap-2">
            {draft && <DeleteDraft invoiceId={invoice.id} />}
            {draft && (
              <Button
                type="button"
                aria-disabled={finalize.isPending || undefined}
                onClick={() => {
                  if (finalize.isPending) return
                  setRefusal(null)
                  finalize.mutate(invoice.id, { onSuccess: (number) => toast.success(t(`${I}.finalized`, { number })) })
                }}
              >
                {t(`${I}.finalize`)}
              </Button>
            )}
            {manage && invoice.status === 'issued' && <CreditNoteButton invoiceId={invoice.id} />}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(invoice.status)}>{statusLabel(invoice.status)}</Badge>
        {invoice.taxExempt && <Badge variant="outline">{t(`${I}.taxExempt`)}</Badge>}
      </div>
      {refusal && <RefusalAlert message={refusal} />}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 text-sm">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`${I}.client`)}</h2>
          <Link to={`/clients/${client.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
            {client.name}
          </Link>
          {client.clientNumber !== null && <p className="text-muted-foreground">{t(`${I}.clientNumber`, { number: String(client.clientNumber) })}</p>}
        </div>
        <div className="space-y-1 text-sm">
          {draft ? (
            <FormField label={t(`${I}.payer`)} help={t(`${I}.payerHelp`)} width="md">
              {(field) => (
                <Select
                  {...field}
                  value={invoice.payerId}
                  onChange={(e) => {
                    setRefusal(null)
                    setPayer.mutate({ invoiceId: invoice.id, payerId: e.target.value })
                  }}
                >
                  {payerOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.isSelf ? t(`${I}.payerSelf`, { name: o.name }) : o.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : (
            <>
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t(`${I}.payer`)}</h2>
              <p className="font-medium">{payer.id === client.id ? t(`${I}.payerSelf`, { name: payer.name }) : payer.name}</p>
            </>
          )}
        </div>
      </section>

      <Lines lines={lines} draft={draft} setRefusal={setRefusal} />
      {draft && <AdjustmentForm invoiceId={invoice.id} />}
      <Totals bundle={bundle} />
      {creditNote && (
        <section className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium">{t(`${I}.creditNote`, { number: creditNote.number, date: formatDateOnly(creditNote.issuedOn) })}</p>
          <p className="text-muted-foreground">{creditNote.reason}</p>
        </section>
      )}
      {manage && <Notes key={`${invoice.notesClient}|${invoice.notesInternal}`} bundle={bundle} />}
    </div>
  )
}

function Lines({ lines, draft, setRefusal }: { lines: readonly InvoiceLine[]; draft: boolean; setRefusal: (m: string | null) => void }) {
  const remove = useRemoveLine({ onErrorMessage: setRefusal })
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">{t(`${I}.noLines`)}</p>
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-sm" aria-label={t(`${I}.lines`)}>
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-3 py-2 font-medium">{t(`${I}.description`)}</th>
            <th className="px-3 py-2 text-right font-medium">{t(`${I}.quantity`)}</th>
            <th className="px-3 py-2 text-right font-medium">{t(`${I}.unitPrice`)}</th>
            <th className="px-3 py-2 text-right font-medium">{t(`${I}.taxes`)}</th>
            <th className="px-3 py-2 text-right font-medium">{t(`${I}.lineTotal`)}</th>
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
                {l.unitPriceCents === null ? (draft ? <PriceInput line={l} setRefusal={setRefusal} /> : '—') : formatCents(l.unitPriceCents)}
              </td>
              <td className="tabular px-3 py-2 text-right text-muted-foreground">
                {l.taxRule === 'taxable' ? formatCents(l.gstCents + l.qstCents) : t(`${I}.untaxed`)}
              </td>
              <td className="tabular px-3 py-2 text-right font-medium">{formatCents(l.totalCents)}</td>
              {draft && (
                <td className="px-3 py-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t(`${I}.removeLine`, { description: l.description })}
                    onClick={() => remove.mutate(l.id)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
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
function PriceInput({ line, setRefusal }: { line: InvoiceLine; setRefusal: (m: string | null) => void }) {
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
        save.mutate({ lineId: line.id, cents }, { onSuccess: () => setValue('') })
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
      <Button type="submit" size="sm" variant="outline" aria-disabled={save.isPending || undefined}>
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
    if (!description.trim()) return setError(t(`${I}.adjustment.descriptionRequired`))
    if (cents === null) return setError(t(`${I}.amountInvalid`))
    if (!Number.isFinite(qty) || qty <= 0) return setError(t(`${I}.adjustment.quantityInvalid`))
    setError(null)
    add.mutate(
      { invoiceId, description: description.trim(), quantity: qty, unitPriceCents: cents, taxable },
      {
        onSuccess: () => {
          setDescription('')
          setQuantity('1')
          setAmount('')
          setTaxable(false)
        },
      },
    )
  }
  return (
    <form noValidate onSubmit={submit} className="space-y-3 rounded-md border border-border p-3" aria-label={t(`${I}.adjustment.title`)}>
      <h2 className="text-sm font-medium">{t(`${I}.adjustment.title`)}</h2>
      <FormRow>
        <FormField label={t(`${I}.adjustment.description`)} width="full" required>
          {(field) => <Input {...field} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />}
        </FormField>
        <FormField label={t(`${I}.quantity`)} width="xs">
          {(field) => <Input {...field} value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" className="tabular" />}
        </FormField>
        <FormField label={t(`${I}.unitPrice`)} width="sm" required>
          {(field) => <Input {...field} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="tabular" />}
        </FormField>
      </FormRow>
      <CheckboxField label={t(`${I}.adjustment.taxable`)} help={t(`${I}.adjustment.taxableHelp`)} checked={taxable} onCheckedChange={setTaxable} />
      {error && <RefusalAlert message={error} />}
      <Button type="submit" variant="outline" aria-disabled={add.isPending || undefined}>
        {t(`${I}.adjustment.add`)}
      </Button>
    </form>
  )
}

function Totals({ bundle }: { bundle: InvoiceBundle }) {
  const { invoice } = bundle
  const percent = (rate: number) => `${new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 3 }).format(rate * 100)}\u00A0%`
  return (
    <dl className="ml-auto w-full max-w-xs space-y-1 text-sm" aria-label={t(`${I}.totals`)}>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">{t(`${I}.subtotal`)}</dt>
        <dd className="tabular">{formatCents(invoice.subtotalCents)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">{t(`${I}.gst`, { rate: percent(invoice.gstRate) })}</dt>
        <dd className="tabular">{formatCents(invoice.gstCents)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">{t(`${I}.qst`, { rate: percent(invoice.qstRate) })}</dt>
        <dd className="tabular">{formatCents(invoice.qstCents)}</dd>
      </div>
      <div className="flex justify-between border-t border-border pt-1 font-semibold">
        <dt>{t(`${I}.total`)}</dt>
        <dd className="tabular">{formatCents(invoice.totalCents)}</dd>
      </div>
    </dl>
  )
}

function Notes({ bundle }: { bundle: InvoiceBundle }) {
  const { invoice } = bundle
  const [client, setClient] = useState(invoice.notesClient ?? '')
  const [internal, setInternal] = useState(invoice.notesInternal ?? '')
  const [error, setError] = useState<string | null>(null)
  const save = useSetInvoiceNotes({ onErrorMessage: setError })
  const dirty = client !== (invoice.notesClient ?? '') || internal !== (invoice.notesInternal ?? '')
  useUnsavedChanges(dirty)
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!dirty || save.isPending) return
        setError(null)
        save.mutate({ invoiceId: invoice.id, notesClient: client.trim() || null, notesInternal: internal.trim() || null })
      }}
    >
      <FormRow>
        <FormField label={t(`${I}.notesClient`)} width="full" help={invoice.status === 'draft' ? t(`${I}.notesClientHelp`) : t(`${I}.notesClientFixed`)}>
          {(field) => (
            <Textarea {...field} value={client} onChange={(e) => setClient(e.target.value)} rows={2} maxLength={2000} readOnly={invoice.status !== 'draft'} />
          )}
        </FormField>
        <FormField label={t(`${I}.notesInternal`)} width="full" help={t(`${I}.notesInternalHelp`)}>
          {(field) => <Textarea {...field} value={internal} onChange={(e) => setInternal(e.target.value)} rows={2} maxLength={5000} />}
        </FormField>
      </FormRow>
      {error && <RefusalAlert message={error} />}
      {dirty && (
        <Button type="submit" variant="outline" aria-disabled={save.isPending || undefined}>
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
            <AlertDialogDescription>{t(`${I}.deleteBody`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate(invoiceId, { onSuccess: () => navigate('/facturation', { replace: true }) })}>
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
              credit.mutate({ invoiceId, reason: reason.trim() }, { onSuccess: () => setOpen(false) })
            }}
          >
            <FormField label={t(`${I}.creditReason`)} width="full" required error={error ?? undefined}>
              {(field) => <Input {...field} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
            </FormField>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('common.cancel')}
                </Button>
              </DialogClose>
              <Button type="submit" aria-disabled={credit.isPending || undefined}>
                {t(`${I}.creditSubmit`)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

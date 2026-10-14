import { useState, type ReactElement } from 'react'
import { ExternalLink } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { useSignedFileUrl } from '@/core/storage/hooks'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { formatClinicDateShort, formatDateOnly } from '@/shared/lib/timezone'
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
import { toast } from '@/shared/ui/sonner'
import type { PayoutLine, PayoutPeriod } from '../../api/payroll'
import { payrollErrorMessage } from '../../api/payroll-errors'
import {
  useAddPayoutAdjustment,
  useForceClearQboBill,
  useMarkPeriodPaid,
  useRebuildPayoutPeriod,
  useRemovePayoutAdjustment,
  useReopenPayoutPeriod,
  useRequestPayoutCorrection,
  useSendPayoutPeriods,
  useValidatePayoutPeriod,
} from '../../hooks/use-payroll'
import { formatPay, monthLabel, stateBadgeVariant, stateLabel } from '../../lib/payroll'
import { AdjustmentDialog, InvoiceDialog, NoteDialog, PaidDialog } from './PayrollDialogs'
import { PayoutLinesTable } from './PayoutLinesTable'
import { QboBillDialog } from './QboBillDialog'

const P = 'modules.billing.payroll.period'

type Open = null | 'correction' | 'adjustment' | 'reopen' | 'paid' | 'validate' | 'rebuild' | 'upload' | 'generate' | 'bill' | 'forceBill'

interface PayoutPeriodDetailProps {
  period: PayoutPeriod
  /** `professional`: « Ma paie » (valider, signaler, sa facture); `staff`: the administration (billing.payroll). */
  audience: 'professional' | 'staff'
}

/**
 * One summary: its state, the notes that explain it (her correction, the reason it was reopened,
 * the payment), its lines and total, her invoice, and the actions of the reader's role. Every
 * action is checked again by the database (state, lock, permission).
 */
export function PayoutPeriodDetail({ period, audience }: PayoutPeriodDetailProps) {
  const [open, setOpen] = useState<Open>(null)
  const staff = audience === 'staff'
  const validate = useValidatePayoutPeriod()
  const correction = useRequestPayoutCorrection()
  const send = useSendPayoutPeriods()
  const rebuild = useRebuildPayoutPeriod()
  const adjust = useAddPayoutAdjustment()
  const removeAdjustment = useRemovePayoutAdjustment()
  const reopen = useReopenPayoutPeriod()
  const paid = useMarkPeriodPaid()
  const forceBill = useForceClearQboBill()
  const { can } = useAccess()
  const [error, setError] = useState<string | null>(null)
  const editable = staff && ['draft', 'to_validate', 'correction_requested'].includes(period.state)
  const name = period.professional?.display_name ?? t(`${P}.unknownProfessional`)
  // BI-23 / BI-27: a Bill in QuickBooks locks the invoice and the reopening until it is forgotten.
  const qboBill = staff && period.state === 'validated' ? (period.invoice?.qbo_bill_id ?? null) : null

  const run = async (action: () => Promise<unknown>, success: string) => {
    setError(null)
    try {
      await action()
      toast.success(success)
    } catch (failure) {
      setError(payrollErrorMessage(failure))
    }
  }

  const actions: ReactElement[] = []
  if (!staff && period.state === 'to_validate') {
    actions.push(
      <Button key="validate" type="button" aria-disabled={validate.isPending || period.unpriced_count > 0 || undefined}
        onClick={() => !validate.isPending && period.unpriced_count === 0 && setOpen('validate')}>
        {t(`${P}.actions.validate`)}
      </Button>,
      <Button key="correction" type="button" variant="outline" onClick={() => setOpen('correction')}>
        {t(`${P}.actions.correction`)}
      </Button>,
    )
  }
  if (staff && (period.state === 'draft' || period.state === 'correction_requested')) {
    actions.push(
      <Button key="send" type="button" aria-disabled={send.isPending || period.unpriced_count > 0 || undefined}
        onClick={() => {
          if (send.isPending || period.unpriced_count > 0) return
          setError(null)
          send.mutateAsync([period.id]).then(
            (result) => (result.sent > 0 ? toast.success(t(`${P}.toasts.sent`, { name })) : setError(t(`${P}.notSent`))),
            (failure: unknown) => setError(payrollErrorMessage(failure)),
          )
        }}>
        {t(period.state === 'draft' ? `${P}.actions.send` : `${P}.actions.sendAgain`)}
      </Button>,
    )
  }
  if (staff && period.state === 'to_validate') {
    actions.push(
      <Button key="validateFor" type="button" variant="outline" aria-disabled={validate.isPending || period.unpriced_count > 0 || undefined}
        onClick={() => !validate.isPending && period.unpriced_count === 0 && setOpen('validate')}>
        {t(`${P}.actions.validateFor`, { name })}
      </Button>,
    )
  }
  if (editable) {
    actions.push(
      <Button key="adjust" type="button" variant="outline" onClick={() => setOpen('adjustment')}>
        {t(`${P}.actions.adjust`)}
      </Button>,
      <Button key="rebuild" type="button" variant="outline" aria-disabled={rebuild.isPending || undefined}
        onClick={() => {
          if (rebuild.isPending) return
          if (period.state === 'to_validate') setOpen('rebuild')
          else void run(() => rebuild.mutateAsync(period.id), t(`${P}.toasts.rebuilt`))
        }}>
        {rebuild.isPending ? t(`${P}.actions.rebuilding`) : t(`${P}.actions.rebuild`)}
      </Button>,
    )
  }
  if (period.state === 'validated') {
    actions.push(
      <Button key="upload" type="button" variant={period.invoice ? 'outline' : 'default'} onClick={() => setOpen('upload')}>
        {t(period.invoice ? `${P}.actions.replaceUpload` : `${P}.actions.upload`)}
      </Button>,
      <Button key="generate" type="button" variant="outline" onClick={() => setOpen('generate')}>
        {t(period.invoice ? `${P}.actions.replaceGenerate` : `${P}.actions.generate`)}
      </Button>,
    )
    if (staff) {
      actions.push(
        <Button key="paid" type="button" aria-disabled={!period.invoice || undefined}
          title={period.invoice ? undefined : t(`${P}.invoiceFirst`)}
          onClick={() => period.invoice && setOpen('paid')}>
          {t(`${P}.actions.paid`)}
        </Button>,
        <Button key="reopen" type="button" variant="outline" onClick={() => setOpen('reopen')}>
          {t(`${P}.actions.reopen`)}
        </Button>,
      )
      if (qboBill) {
        actions.push(
          <Button key="billVoided" type="button" variant="outline" onClick={() => setOpen('bill')}>
            {t(`${P}.actions.billVoided`)}
          </Button>,
        )
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Badge variant={stateBadgeVariant(period.state)}>
          {stateLabel(period.state)}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {staff && period.title_name ? `${period.title_name} · ` : ''}
          {t(`${P}.lineCount`, { count: String(period.lines_count) })}
        </span>
        {period.paid_on && <span className="text-sm text-muted-foreground">{t(`${P}.paidOn`, { date: formatDateOnly(period.paid_on) })}</span>}
      </div>
      <StateNotice period={period} audience={audience} />
      {qboBill && <p className="text-sm text-muted-foreground">{t(`${P}.notices.inQuickbooks`, { bill: qboBill })}</p>}
      {error && <RefusalAlert message={error} />}
      <PayoutLinesTable
        lines={period.lines}
        totalCents={period.total_cents}
        onRemoveAdjustment={editable ? (line: PayoutLine) => void run(() => removeAdjustment.mutateAsync(line.id), t(`${P}.toasts.adjustmentRemoved`)) : undefined}
        removing={removeAdjustment.isPending}
      />
      <InvoiceSummary period={period} />
      {actions.length > 0 && <div className="flex flex-wrap gap-2">{actions}</div>}

      {open === 'validate' && (
        <AlertDialog open onOpenChange={(o) => !o && setOpen(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`${P}.validateDialog.title`, { month: monthLabel(period.month) })}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(staff ? `${P}.validateDialog.staffBody` : `${P}.validateDialog.body`, { amount: formatPay(period.total_cents), name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void run(() => validate.mutateAsync(period.id), t(`${P}.toasts.validated`))}>
                {t(`${P}.validateDialog.confirm`)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {open === 'rebuild' && (
        <AlertDialog open onOpenChange={(o) => !o && setOpen(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`${P}.rebuildDialog.title`)}</AlertDialogTitle>
              <AlertDialogDescription>{t(`${P}.rebuildDialog.body`, { name })}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void run(() => rebuild.mutateAsync(period.id), t(`${P}.toasts.rebuilt`))}>
                {t(`${P}.actions.rebuild`)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {open === 'correction' && (
        <NoteDialog
          title={t(`${P}.correctionDialog.title`)}
          description={t(`${P}.correctionDialog.description`, { month: monthLabel(period.month) })}
          label={t(`${P}.correctionDialog.label`)}
          help={t(`${P}.correctionDialog.help`)}
          submitLabel={t(`${P}.correctionDialog.submit`)}
          min={3}
          max={2000}
          onSubmit={async (note) => {
            await correction.mutateAsync({ id: period.id, note })
            toast.success(t(`${P}.toasts.correction`))
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'reopen' && (
        <NoteDialog
          title={t(`${P}.reopenDialog.title`)}
          description={t(`${P}.reopenDialog.description`, { name })}
          label={t(`${P}.reopenDialog.label`)}
          submitLabel={t(`${P}.reopenDialog.submit`)}
          min={3}
          max={500}
          onSubmit={async (reason) => {
            await reopen.mutateAsync({ id: period.id, reason })
            toast.success(t(`${P}.toasts.reopened`))
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'bill' && qboBill && (
        <QboBillDialog
          periodId={period.id}
          billId={qboBill}
          canForce={can('billing.settings')}
          onCleared={() => {
            toast.success(t(`${P}.toasts.billCleared`))
            setOpen(null)
          }}
          onForce={() => setOpen('forceBill')}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'forceBill' && qboBill && (
        <NoteDialog
          title={t(`${P}.forceDialog.title`, { bill: qboBill })}
          description={t(`${P}.forceDialog.description`)}
          warning={t(`${P}.forceDialog.warning`)}
          label={t(`${P}.forceDialog.label`)}
          help={t(`${P}.forceDialog.help`)}
          submitLabel={t(`${P}.forceDialog.submit`)}
          min={10}
          max={500}
          onSubmit={async (reason) => {
            await forceBill.mutateAsync({ periodId: period.id, reason })
            toast.success(t(`${P}.toasts.billCleared`))
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'adjustment' && (
        <AdjustmentDialog
          onSubmit={async (amountCents, note) => {
            await adjust.mutateAsync({ periodId: period.id, amountCents, note })
            toast.success(t(`${P}.toasts.adjusted`))
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === 'paid' && (
        <PaidDialog
          professionalName={name}
          totalCents={period.total_cents}
          onSubmit={async (paidOn, note) => {
            await paid.mutateAsync({ id: period.id, paidOn, note })
            toast.success(t(`${P}.toasts.paid`, { name }))
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {(open === 'upload' || open === 'generate') && (
        <InvoiceDialog
          mode={open}
          periodId={period.id}
          month={period.month}
          totalCents={period.total_cents}
          onDone={() => {
            toast.success(t(open === 'upload' ? `${P}.toasts.uploaded` : `${P}.toasts.generated`))
            setOpen(null)
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

/** What the state asks of the reader, in plain words. */
function StateNotice({ period, audience }: PayoutPeriodDetailProps) {
  const staff = audience === 'staff'
  const lines: string[] = []
  if (period.unpriced_count > 0) lines.push(t(staff ? `${P}.notices.unpricedStaff` : `${P}.notices.unpriced`, { count: String(period.unpriced_count) }))
  if (period.state === 'draft') lines.push(t(`${P}.notices.draft`))
  if (period.state === 'to_validate' && !staff) lines.push(t(`${P}.notices.toValidate`))
  if (period.state === 'to_validate' && staff) lines.push(t(`${P}.notices.toValidateStaff`))
  if (period.state === 'validated' && !period.invoice) lines.push(t(staff ? `${P}.notices.invoiceMissingStaff` : `${P}.notices.invoiceMissing`))
  if (period.state === 'validated' && period.invoice && staff) lines.push(t(`${P}.notices.readyToPay`))
  return (
    <>
      {period.state === 'correction_requested' && period.correction_note && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <p className="font-medium">
            {t(`${P}.notices.correction`, { date: period.correction_requested_at ? formatClinicDateShort(period.correction_requested_at) : '' })}
          </p>
          <p className="mt-1 whitespace-pre-line">{period.correction_note}</p>
        </div>
      )}
      {period.reopen_reason && period.state === 'to_validate' && (
        <p className="text-sm text-muted-foreground">{t(`${P}.notices.reopened`, { reason: period.reopen_reason })}</p>
      )}
      {lines.map((line) => (
        <p key={line} className="text-sm text-muted-foreground">
          {line}
        </p>
      ))}
    </>
  )
}

/** Her invoice, when attached: its number, date, how it was made, and a link to open it. */
function InvoiceSummary({ period }: { period: PayoutPeriod }) {
  const invoice = period.invoice
  const url = useSignedFileUrl(invoice?.file_id ?? null, { refresh: true })
  if (!invoice) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-medium">
        {t(`${P}.invoice.summary`, { number: invoice.number, date: formatDateOnly(invoice.issued_on) })}
      </span>
      <span className="text-muted-foreground">{t(`${P}.invoice.${invoice.source}`)}</span>
      {url.data ? (
        <a href={url.data.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
          {t(`${P}.invoice.open`)}
          <ExternalLink aria-hidden className="h-3.5 w-3.5" />
        </a>
      ) : url.isError ? (
        <span className="text-muted-foreground">{t(`${P}.invoice.unavailable`)}</span>
      ) : null}
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { uploadErrorMessage } from '@/core/storage/errors'
import { FileDropzone } from '@/shared/components/FileDropzone'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import type { UploadStep } from '@/shared/lib/files'
import { getClinicDateString } from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { DateField } from '@/shared/ui/date-field'
import { INVOICE_MAX_BYTES, INVOICE_MIME } from '../../api/payroll'
import { payrollErrorMessage } from '../../api/payroll-errors'
import { useGenerateProfessionalInvoice, useUploadProfessionalInvoice } from '../../hooks/use-payroll'
import { formatPay, invoiceDateError, invoiceNumberError, monthLabel, parseAdjustment, suggestedInvoiceNumber } from '../../lib/payroll'

const D = 'modules.billing.payroll.dialogs'

interface NoteDialogProps {
  title: string
  description: string
  label: string
  help?: string
  /** A warning shown above the note (« Forcer le retrait » of a Bill). */
  warning?: string
  submitLabel: string
  min: number
  max: number
  /** Resolves when done (the dialog closes); a rejection is shown in the dialog. */
  onSubmit: (note: string) => Promise<unknown>
  onClose: () => void
}

/** A note to write, then one action (« Signaler une correction », « Rouvrir »). */
export function NoteDialog({ title, description, label, help, warning, submitLabel, min, max, onSubmit, onClose }: NoteDialogProps) {
  const [note, setNote] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const value = note.trim()
    if (value.length < min || value.length > max) {
      setFieldError(t(`${D}.noteLength`, { min: String(min), max: String(max) }))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(value)
      onClose()
    } catch (failure) {
      setError(payrollErrorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent aria-busy={busy || undefined}>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {warning && (
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              <AlertDescription className="text-foreground">{warning}</AlertDescription>
            </Alert>
          )}
          {error && <RefusalAlert message={error} />}
          <FormField label={label} help={help} required error={fieldError ?? undefined}>
            {(field) => (
              <Textarea
                {...field}
                value={note}
                rows={4}
                maxLength={max}
                readOnly={busy}
                onChange={(event) => {
                  setNote(event.target.value)
                  setFieldError(null)
                }}
              />
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" aria-disabled={busy || undefined} onClick={() => !busy && onClose()}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" aria-disabled={busy || undefined}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface AdjustmentDialogProps {
  onSubmit: (amountCents: number, note: string) => Promise<unknown>
  onClose: () => void
}

/** « Ajouter un ajustement »: an amount in dollars (negative to deduct) and why. */
export function AdjustmentDialog({ onSubmit, onClose }: AdjustmentDialogProps) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ amount?: string; note?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const cents = parseAdjustment(amount)
    const text = note.trim()
    const next = {
      amount: cents === null ? t(`${D}.adjustment.amountInvalid`) : undefined,
      note: text.length < 3 || text.length > 500 ? t(`${D}.noteLength`, { min: '3', max: '500' }) : undefined,
    }
    setErrors(next)
    if (cents === null || next.note) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(cents, text)
      onClose()
    } catch (failure) {
      setError(payrollErrorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent aria-busy={busy || undefined}>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t(`${D}.adjustment.title`)}</DialogTitle>
            <DialogDescription>{t(`${D}.adjustment.description`)}</DialogDescription>
          </DialogHeader>
          {error && <RefusalAlert message={error} />}
          <FormField label={t(`${D}.adjustment.amount`)} help={t(`${D}.adjustment.amountHelp`)} required error={errors.amount}>
            {(field) => (
              <Input
                {...field}
                inputMode="decimal"
                value={amount}
                readOnly={busy}
                className="max-w-[10rem] tabular"
                onChange={(event) => {
                  setAmount(event.target.value)
                  setErrors((e) => ({ ...e, amount: undefined }))
                }}
              />
            )}
          </FormField>
          <FormField label={t(`${D}.adjustment.note`)} required error={errors.note}>
            {(field) => (
              <Textarea
                {...field}
                value={note}
                rows={3}
                maxLength={500}
                readOnly={busy}
                onChange={(event) => {
                  setNote(event.target.value)
                  setErrors((e) => ({ ...e, note: undefined }))
                }}
              />
            )}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" aria-disabled={busy || undefined} onClick={() => !busy && onClose()}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" aria-disabled={busy || undefined}>
              {t(`${D}.adjustment.submit`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface PaidDialogProps {
  professionalName: string
  totalCents: number
  onSubmit: (paidOn: string, note: string) => Promise<unknown>
  onClose: () => void
}

/** « Marquer comme versée »: the payment's date (default: the clinic's today) and an optional note. */
export function PaidDialog({ professionalName, totalCents, onSubmit, onClose }: PaidDialogProps) {
  const [paidOn, setPaidOn] = useState(() => getClinicDateString(new Date()))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(paidOn, note)
      onClose()
    } catch (failure) {
      setError(payrollErrorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent aria-busy={busy || undefined}>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t(`${D}.paid.title`)}</DialogTitle>
            <DialogDescription>{t(`${D}.paid.description`, { name: professionalName, amount: formatPay(totalCents) })}</DialogDescription>
          </DialogHeader>
          {error && <RefusalAlert message={error} />}
          <FormField label={t(`${D}.paid.date`)} required>
            {(field) => (
              <DateField {...field} value={paidOn} readOnly={busy} className="max-w-[12rem]" onChange={setPaidOn} />
            )}
          </FormField>
          <FormField label={t(`${D}.paid.note`)} help={t(`${D}.paid.noteHelp`)}>
            {(field) => <Input {...field} value={note} maxLength={500} readOnly={busy} onChange={(event) => setNote(event.target.value)} />}
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" aria-disabled={busy || undefined} onClick={() => !busy && onClose()}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" aria-disabled={busy || undefined}>
              {t(`${D}.paid.submit`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** A check that stopped the upload: said under its field, and in the zone. */
class FieldCheckError extends Error {}

interface InvoiceDialogProps {
  mode: 'upload' | 'generate'
  periodId: string
  month: string
  totalCents: number
  onDone: () => void
  onClose: () => void
}

/**
 * « Téléverser ma facture » / « Générer ma facture »: her invoice number (suggested: the month,
 * « 2026-11 ») and its date (the month's 1st to today), then the file (PDF, JPEG or PNG, sent
 * through the storage pipeline) or the generated PDF. Both are checked before anything is sent.
 */
export function InvoiceDialog({ mode, periodId, month, totalCents, onDone, onClose }: InvoiceDialogProps) {
  const today = getClinicDateString(new Date())
  const [number, setNumber] = useState(() => suggestedInvoiceNumber(month))
  const [issuedOn, setIssuedOn] = useState(today)
  const [errors, setErrors] = useState<{ number?: string; date?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const upload = useUploadProfessionalInvoice()
  const generate = useGenerateProfessionalInvoice()
  const busy = upload.isPending || generate.isPending

  const check = (): boolean => {
    const next = { number: invoiceNumberError(number) ?? undefined, date: invoiceDateError(issuedOn, month, today) ?? undefined }
    setErrors(next)
    return !next.number && !next.date
  }

  const send = async (file: File, mimeType: string, onStep: (step: UploadStep) => void) => {
    if (!check()) throw new FieldCheckError(t(`${D}.invoice.fixFields`))
    await upload.mutateAsync({ periodId, file, mimeType, number, issuedOn, onStep })
    onDone()
  }

  const submitGenerate = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !check()) return
    setError(null)
    try {
      await generate.mutateAsync({ periodId, number, issuedOn })
      onDone()
    } catch (failure) {
      setError(payrollErrorMessage(failure))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent aria-busy={busy || undefined}>
        <form onSubmit={submitGenerate} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t(`${D}.invoice.${mode}Title`)}</DialogTitle>
            <DialogDescription>
              {t(`${D}.invoice.${mode}Description`, { month: monthLabel(month), amount: formatPay(totalCents) })}
            </DialogDescription>
          </DialogHeader>
          {error && <RefusalAlert message={error} />}
          <FormField label={t(`${D}.invoice.number`)} help={t(`${D}.invoice.numberHelp`)} required error={errors.number}>
            {(field) => (
              <Input
                {...field}
                value={number}
                maxLength={40}
                readOnly={busy}
                className="max-w-[14rem]"
                onChange={(event) => {
                  setNumber(event.target.value)
                  setErrors((e) => ({ ...e, number: undefined }))
                }}
              />
            )}
          </FormField>
          <FormField label={t(`${D}.invoice.date`)} required error={errors.date}>
            {(field) => (
              <DateField
                {...field}
                value={issuedOn}
                min={month}
                max={today}
                readOnly={busy}
                className="max-w-[12rem]"
                onChange={(value) => {
                  setIssuedOn(value)
                  setErrors((e) => ({ ...e, date: undefined }))
                }}
              />
            )}
          </FormField>
          {mode === 'upload' && (
            <FileDropzone
              buttonLabel={t(`${D}.invoice.choose`)}
              hint={t(`${D}.invoice.hint`)}
              accept={INVOICE_MIME}
              maxBytes={INVOICE_MAX_BYTES}
              onUpload={send}
              errorMessage={(failure) => (failure instanceof FieldCheckError ? failure.message : uploadErrorMessage(failure))}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" aria-disabled={busy || undefined} onClick={() => !busy && onClose()}>
              {t('common.cancel')}
            </Button>
            {mode === 'generate' && (
              <Button type="submit" aria-disabled={busy || undefined}>
                {generate.isPending ? t(`${D}.invoice.generating`) : t(`${D}.invoice.generate`)}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

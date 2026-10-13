import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnly, getClinicDateString } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { toast } from '@/shared/ui/sonner'
import { NOTICE_STATES, type InteracNotice, type NoticeState } from '../api/stripe'
import { stripeErrorMessage } from '../api/stripe-errors'
import { NoteDialog } from '../components/payroll/PayrollDialogs'
import { useAddInteracNotice, useIgnoreInteracNotice, useInteracNotices, useMatchInteracNotice } from '../hooks/use-stripe'
import { formatPay, parseAdjustment } from '../lib/payroll'

const I = 'modules.billing.interac'

/**
 * « Virements Interac » (`/facturation/virements`, billing.view; changes with billing.manage, FS-6):
 * the transfer notices received at administration@ to match with an invoice. A notice is typed
 * here (date, amount, sender, message) until Communications reads them (CM1b); each one suggests
 * the issued invoices whose balance is its amount, the payer's name in the sender's first;
 * « Rapprocher » records the payment (mode Interac, its receipt), « Ignorer » sets it aside.
 */
export function InteracPage() {
  usePageTitle(t(`${I}.title`))
  const { can } = useAccess()
  const [status, setStatus] = useState<NoticeState>('to_match')
  const notices = useInteracNotices(status)
  const manage = can('billing.manage')

  let body
  if (notices.isPending) body = <Loading />
  else if (notices.isError && !notices.data) {
    body = <LoadError message={t(`${I}.loadError`)} retrying={notices.isFetching} onRetry={() => void notices.refetch()} />
  } else if (notices.data.length === 0) body = <EmptyState title={t(`${I}.empty.${status}`)} />
  else {
    body = (
      <ul className="space-y-3">
        {notices.data.map((n) => (
          <NoticeCard key={n.id} notice={n} manage={manage} />
        ))}
      </ul>
    )
  }
  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${I}.title`)} description={t(`${I}.description`)} />
      {manage && <AddNoticeCard />}
      <SegmentedToggle
        label={t(`${I}.filterLabel`)}
        value={status}
        onChange={setStatus}
        options={NOTICE_STATES.map((value) => ({ value, label: t(`${I}.states.${value}`) }))}
      />
      {body}
    </div>
  )
}

function AddNoticeCard() {
  const today = getClinicDateString(new Date())
  const [receivedOn, setReceivedOn] = useState(today)
  const [amount, setAmount] = useState('')
  const [sender, setSender] = useState('')
  const [message, setMessage] = useState('')
  const [reference, setReference] = useState('')
  const [errors, setErrors] = useState<{ amount?: string; sender?: string }>({})
  const [refusal, setRefusal] = useState<string | null>(null)
  const add = useAddInteracNotice()
  const dirty = amount !== '' || sender !== '' || message !== '' || reference !== ''
  useUnsavedChanges(dirty)

  const reset = () => {
    setReceivedOn(today)
    setAmount('')
    setSender('')
    setMessage('')
    setReference('')
    setErrors({})
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (add.isPending) return
    const cents = parseAdjustment(amount)
    const next = {
      amount: cents === null || cents < 0 ? t(`${I}.add.amountInvalid`) : undefined,
      sender: sender.trim() === '' ? t(`${I}.add.senderRequired`) : undefined,
    }
    setErrors(next)
    if (next.amount || next.sender || cents === null) return
    setRefusal(null)
    add.mutateAsync({ receivedOn, amountCents: cents, senderName: sender, message, reference }).then(
      () => {
        toast.success(t(`${I}.add.saved`))
        reset()
      },
      (failure: unknown) => setRefusal(stripeErrorMessage(failure)),
    )
  }

  return (
    <SettingsCard
      title={t(`${I}.add.title`)}
      description={t(`${I}.add.description`)}
      dirty={dirty}
      pending={add.isPending}
      onSubmit={submit}
      footer={
        <div className="flex justify-end gap-2">
          {dirty && (
            <Button type="button" variant="outline" onClick={reset}>
              {t('common.cancel')}
            </Button>
          )}
          <Button type="submit" aria-disabled={add.isPending || undefined}>
            {t(`${I}.add.submit`)}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3.5 sm:grid-cols-2">
        {refusal && (
          <div className="sm:col-span-2">
            <RefusalAlert message={refusal} />
          </div>
        )}
        <FormField label={t(`${I}.add.date`)} required>
          {(field) => (
            <Input {...field} type="date" max={today} value={receivedOn} className="max-w-[12rem] tabular" onChange={(e) => setReceivedOn(e.target.value)} />
          )}
        </FormField>
        <FormField label={t(`${I}.add.amount`)} required error={errors.amount}>
          {(field) => (
            <Input {...field} inputMode="decimal" value={amount} className="max-w-[10rem] tabular" onChange={(e) => setAmount(e.target.value)} />
          )}
        </FormField>
        <FormField label={t(`${I}.add.sender`)} help={t(`${I}.add.senderHelp`)} required error={errors.sender}>
          {(field) => <Input {...field} value={sender} maxLength={120} onChange={(e) => setSender(e.target.value)} />}
        </FormField>
        <FormField label={t(`${I}.add.reference`)}>
          {(field) => <Input {...field} value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />}
        </FormField>
        <div className="sm:col-span-2">
          <FormField label={t(`${I}.add.message`)} help={t(`${I}.add.messageHelp`)}>
            {(field) => <Input {...field} value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} />}
          </FormField>
        </div>
      </div>
    </SettingsCard>
  )
}

function NoticeCard({ notice, manage }: { notice: InteracNotice; manage: boolean }) {
  const match = useMatchInteracNotice()
  const ignore = useIgnoreInteracNotice()
  const [refusal, setRefusal] = useState<string | null>(null)
  const [ignoring, setIgnoring] = useState(false)

  const matchWith = (invoiceId: string, number: string | null) => {
    if (match.isPending) return
    setRefusal(null)
    match.mutateAsync({ noticeId: notice.id, invoiceId }).then(
      () => toast.success(t(`${I}.matched`, { number: number ?? '' })),
      (failure: unknown) => setRefusal(stripeErrorMessage(failure)),
    )
  }

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">
          <span className="tabular">{formatPay(notice.amount_cents)}</span> · {notice.sender_name}
        </p>
        <p className="text-xs text-muted-foreground">
          {t(`${I}.receivedOn`, { date: formatDateOnly(notice.received_on) })}
          {notice.source === 'gmail' && ` · ${t(`${I}.fromMailbox`)}`}
        </p>
      </div>
      {(notice.message || notice.reference) && (
        <p className="mt-1 text-sm text-muted-foreground">
          {[notice.message, notice.reference && t(`${I}.reference`, { reference: notice.reference })].filter(Boolean).join(' · ')}
        </p>
      )}
      {refusal && (
        <div className="mt-2">
          <RefusalAlert message={refusal} />
        </div>
      )}
      {notice.status === 'matched' && notice.invoice_id && (
        <p className="mt-2 text-sm">
          <Badge variant="success">{t(`${I}.states.matched`)}</Badge>{' '}
          <Link to={`/facturation/factures/${notice.invoice_id}`} className="underline-offset-2 hover:underline">
            {t(`${I}.invoice`, { number: notice.invoice_number ?? '' })}
          </Link>
        </p>
      )}
      {notice.status === 'ignored' && <p className="mt-2 text-sm text-muted-foreground">{t(`${I}.ignoredBecause`, { reason: notice.ignored_reason ?? '' })}</p>}
      {notice.status === 'to_match' && (
        <div className="mt-3 space-y-2">
          {(notice.suggestions ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(`${I}.noSuggestion`)}</p>
          ) : (
            <ul className="space-y-2" aria-label={t(`${I}.suggestions`)}>
              {(notice.suggestions ?? []).map((s) => (
                <li key={s.invoice_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                  <span>
                    <Link to={`/facturation/factures/${s.invoice_id}`} className="font-medium underline-offset-2 hover:underline">
                      {t(`${I}.invoice`, { number: s.number ?? '' })}
                    </Link>{' '}
                    · {s.payer_name}
                    {s.client_name && s.client_name !== s.payer_name && ` (${s.client_name})`} · {t(`${I}.balance`, { amount: formatPay(s.balance_cents) })}
                    {s.amount_matches && <Badge variant="success" className="ml-2">{t(`${I}.amountMatches`)}</Badge>}
                    {s.name_score > 0 && <Badge variant="info" className="ml-2">{t(`${I}.nameMatches`)}</Badge>}
                  </span>
                  {manage && (
                    <Button type="button" variant="outline" aria-disabled={match.isPending || undefined} onClick={() => matchWith(s.invoice_id, s.number)}>
                      {t(`${I}.match`, { number: s.number ?? '' })}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {manage && (
            <Button type="button" variant="ghost" onClick={() => setIgnoring(true)}>
              {t(`${I}.ignore`)}
            </Button>
          )}
        </div>
      )}
      {ignoring && (
        <NoteDialog
          title={t(`${I}.ignoreDialog.title`)}
          description={t(`${I}.ignoreDialog.description`, { amount: formatPay(notice.amount_cents), sender: notice.sender_name })}
          label={t(`${I}.ignoreDialog.label`)}
          submitLabel={t(`${I}.ignore`)}
          min={3}
          max={300}
          onSubmit={async (reason) => {
            await ignore.mutateAsync({ noticeId: notice.id, reason })
            toast.success(t(`${I}.ignored`))
          }}
          onClose={() => setIgnoring(false)}
        />
      )}
    </li>
  )
}

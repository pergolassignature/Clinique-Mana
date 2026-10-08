import { forwardRef, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarPlus } from 'lucide-react'
import { t } from '@/i18n'
import { rpcErrorHint } from '@/core/modules/errors'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import type { SessionRow } from '../../api/compensation'
import { useRecordSessions } from '../../hooks/use-compensation'
import { formatSessions, monthCount, monthOf, parseSessions, shiftMonth } from '../../lib/compensation'
import { sessionsSchema, type SessionsFormValues, type SessionsInput } from '../../schemas/compensation'
import { DialogForm } from '../compensation/DatedRowParts'

const S = 'modules.professionals.record.compensation.sessions'

interface SessionsDialogProps {
  professionalId: string
  /** The professional's months (newest first), to prefill a month already entered and send its version. */
  rows: readonly SessionRow[]
  /** The cumulative count today, for the live « nouveau total ». */
  total: number
}

const valuesOf = (month: string, row: SessionRow | undefined): SessionsFormValues => ({
  month: month.slice(0, 7),
  long: row ? String(row.long) : '',
  short: row ? String(row.short) : '',
  adjustment: row && row.adjustment !== 0 ? formatSessions(row.adjustment) : '',
  note: row?.note ?? '',
})

/**
 * « Ajouter les séances du mois » (P4-186): a month (last month by default, the one the monthly
 * review closes), its 50/60-minute and 30-minute sessions and an optional adjustment (an opening
 * balance or a correction). A month already entered opens with its values: saving replaces them.
 * The month's version is the one read when it was chosen; a change by someone else meanwhile is
 * refused (HINT `stale`), the newer values are shown and the next save goes through.
 */
export const SessionsDialog = forwardRef<HTMLButtonElement, SessionsDialogProps>(function SessionsDialog({ professionalId, rows, total }, ref) {
  const [open, setOpen] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const save = useRecordSessions(professionalId, {
    onErrorMessage: (message, error) => {
      if (rpcErrorHint(error) === 'stale') {
        setStale(true)
        setRefusal(t(`${S}.stale`))
      } else setRefusal(message)
    },
  })
  const firstField = useRef<HTMLInputElement | null>(null)

  const onOpenChange = (next: boolean) => {
    if (save.isPending) return
    if (!next) {
      save.reset()
      setRefusal(null)
      setStale(false)
    }
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button ref={ref} type="button" variant="outline" size="sm">
          <CalendarPlus aria-hidden />
          {t(`${S}.add`)}
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          firstField.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(`${S}.dialog.title`)}</DialogTitle>
          <DialogDescription>{t(`${S}.dialog.description`)}</DialogDescription>
        </DialogHeader>
        <SessionsForm
          rows={rows}
          total={total}
          firstFieldRef={firstField}
          pending={save.isPending}
          refusal={refusal}
          stale={stale}
          onStaleSeen={() => setStale(false)}
          onSubmit={(input, expectedUpdatedAt) => {
            setRefusal(null)
            save.mutate(
              { month: input.month, entry: { long: input.long, short: input.short, adjustment: input.adjustment, note: input.note, expectedUpdatedAt } },
              { onSuccess: () => setOpen(false) },
            )
          }}
        />
      </DialogContent>
    </Dialog>
  )
})

interface SessionsFormProps {
  rows: readonly SessionRow[]
  total: number
  firstFieldRef: RefObject<HTMLInputElement | null>
  pending: boolean
  refusal: string | null
  /** A save was refused as stale: take the refetched month's version and values. */
  stale: boolean
  onStaleSeen: () => void
  onSubmit: (input: SessionsInput, expectedUpdatedAt: string | null) => void
}

function SessionsForm({ rows, total, firstFieldRef, pending, refusal, stale, onStaleSeen, onSubmit }: SessionsFormProps) {
  const today = useClinicDate()
  const currentMonth = monthOf(today)
  const lastMonth = shiftMonth(currentMonth, -1)
  const rowFor = (month: string) => rows.find((row) => row.month === month)
  const resolver = useMemo(() => zodResolver(sessionsSchema(currentMonth)), [currentMonth])
  const form = useForm<SessionsFormValues, unknown, SessionsInput>({ resolver, defaultValues: valuesOf(lastMonth, rowFor(lastMonth)) })
  const { errors, isDirty } = form.formState
  const [version, setVersion] = useState<{ month: string; updatedAt: string | null }>(() => ({ month: lastMonth, updatedAt: rowFor(lastMonth)?.updatedAt ?? null }))
  const [monthText, long, short, adjustment] = useWatch({ control: form.control, name: ['month', 'long', 'short', 'adjustment'] })
  const month = /^[0-9]{4}-[0-9]{2}$/.test(monthText) ? `${monthText}-01` : null

  // Another month chosen: its stored values and version.
  useEffect(() => {
    if (month === null || month === version.month) return
    const row = rows.find((r) => r.month === month)
    setVersion({ month, updatedAt: row?.updatedAt ?? null })
    form.reset(valuesOf(month, row), { keepDefaultValues: true })
    // Only a change of month resets the fields (rows refetching must not erase what is typed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])
  // After a stale refusal, the refetched month is the one to build on (P4-163's rule).
  useEffect(() => {
    if (!stale || month === null) return
    const row = rows.find((r) => r.month === month)
    // Wait for the refetch: until it lands, the month reads as it did when the save was refused.
    if ((row?.updatedAt ?? null) === version.updatedAt) return
    setVersion({ month, updatedAt: row?.updatedAt ?? null })
    form.reset(valuesOf(month, row), { keepDefaultValues: true })
    onStaleSeen()
  }, [stale, rows, month, version.updatedAt, form, onStaleSeen])

  // The live new total: the stored total, minus this month's stored count, plus what is typed.
  const stored = month ? rowFor(month) : undefined
  const typed = [parseSessions(long || '0', { signed: false, half: false }), parseSessions(short || '0', { signed: false, half: false }), parseSessions(adjustment || '0', { signed: true, half: true })]
  const newTotal =
    typed.every((value) => value !== null) && month !== null
      ? total - (stored ? monthCount(stored.long, stored.short, stored.adjustment) : 0) + monthCount(typed[0] ?? 0, typed[1] ?? 0, typed[2] ?? 0)
      : null
  const { ref: monthRef, ...monthField } = form.register('month')

  return (
    <DialogForm
      onSubmit={(event) => void form.handleSubmit((input) => onSubmit(input, version.updatedAt))(event)}
      pending={pending}
      dirty={isDirty || stored === undefined}
      refusal={refusal}
      submitLabel={t('common.save')}
      pendingLabel={t('common.saving')}
    >
      <FormField label={t(`${S}.dialog.month`)} help={stored ? t(`${S}.dialog.monthEntered`) : undefined} required error={errors.month?.message}>
        {(field) => (
          <Input
            {...field}
            {...monthField}
            ref={(element) => {
              monthRef(element)
              firstFieldRef.current = element
            }}
            type="month"
            min="2000-01"
            max={currentMonth.slice(0, 7)}
          />
        )}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t(`${S}.dialog.long`)} help={t(`${S}.dialog.longHelp`)} error={errors.long?.message}>
          {(field) => <Input {...field} {...form.register('long')} inputMode="numeric" autoComplete="off" />}
        </FormField>
        <FormField label={t(`${S}.dialog.short`)} help={t(`${S}.dialog.shortHelp`)} error={errors.short?.message}>
          {(field) => <Input {...field} {...form.register('short')} inputMode="numeric" autoComplete="off" />}
        </FormField>
      </div>
      <FormField label={t(`${S}.dialog.adjustment`)} help={t(`${S}.dialog.adjustmentHelp`)} error={errors.adjustment?.message}>
        {(field) => <Input {...field} {...form.register('adjustment')} inputMode="decimal" autoComplete="off" />}
      </FormField>
      <FormField label={t('modules.professionals.compensation.note')} help={t('modules.professionals.compensation.noteHelp')} error={errors.note?.message}>
        {(field) => <Input {...field} {...form.register('note')} autoComplete="off" maxLength={500} />}
      </FormField>
      <p role="status" className="text-sm text-muted-foreground">
        {newTotal !== null && newTotal >= 0 && t(`${S}.dialog.newTotal`, { total: formatSessions(newTotal) })}
      </p>
    </DialogForm>
  )
}

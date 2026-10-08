import { forwardRef, useMemo, useRef, useState, type RefObject } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { formatDateOnlyShort, shiftCalendarDay } from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { DURATIONS, type AgreementInput, type AgreementRow } from '../../api/compensation'
import { useDeleteClientAgreement, useEndClientAgreement, useSetClientAgreement } from '../../hooks/use-compensation'
import { canDeleteDated, datedStatus, durationLabel, formatCents, periodLabel } from '../../lib/compensation'
import { agreementEndSchema, agreementSchema, LAST_DATE, type AgreementFormValues } from '../../schemas/compensation'
import { ConfirmDeleteDialog, DatedStatusBadge, DialogForm, EffectiveFromField } from '../compensation/DatedRowParts'
import { useDateErrorOnField, useDialogRefusal, type DateError } from '../compensation/dialog-state'

const A = 'modules.professionals.record.compensation.agreements'
const W = 'modules.professionals.compensation'

/** The rows of one client and duration (an agreement's series), newest first. */
const seriesOf = (rows: readonly AgreementRow[], row: AgreementRow) =>
  rows.filter((other) => other.duration === row.duration && other.clientLabel.toLowerCase() === row.clientLabel.toLowerCase())

interface AgreementsSectionProps {
  professionalId: string
  rows: readonly AgreementRow[]
  today: string
  now: number
}

/**
 * « Ententes particulières » (P4-183, Jonathan): for one client (a file number or initials, never
 * a name) and one duration, the client's price and the fixed amount paid to the professional per
 * session. The retention does not apply to them. Rows still in force or coming first, then the
 * ended ones; « Mettre fin » on a series' last row, « Supprimer » where the database allows it.
 */
export function AgreementsSection({ professionalId, rows, today, now }: AgreementsSectionProps) {
  const [toDelete, setToDelete] = useState<AgreementRow | null>(null)
  const [toEnd, setToEnd] = useState<AgreementRow | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const remove = useDeleteClientAgreement(professionalId, { onErrorMessage: (message) => setRefusal(message) })
  const trigger = useRef<HTMLButtonElement | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const ordered = [...rows].sort((a, b) => Number(datedStatus(a, today) === 'ended') - Number(datedStatus(b, today) === 'ended') || b.effectiveFrom.localeCompare(a.effectiveFrom))

  return (
    <section aria-labelledby={`${professionalId}-agreements`} className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 id={`${professionalId}-agreements`} className="text-sm font-semibold">
            {t(`${A}.title`)}
          </h4>
          <p className="text-xs text-muted-foreground">{t(`${A}.description`)}</p>
        </div>
        <AgreementDialog ref={addButton} professionalId={professionalId} />
      </div>
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${A}.none`)}</p>
      ) : (
        <ul className="divide-y divide-border-light rounded-md border border-border-light">
          {ordered.map((row) => {
            const series = seriesOf(rows, row)
            const last = !series.some((other) => other.effectiveFrom > row.effectiveFrom)
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium">{t(`${A}.client`, { client: row.clientLabel, duration: durationLabel(row.duration) })}</span>
                <DatedStatusBadge status={datedStatus(row, today)} />
                <span className="basis-full text-sm">
                  {t(`${A}.amounts`, { price: formatCents(row.clientPriceCents), amount: formatCents(row.professionalAmountCents) })}
                </span>
                <span className="text-xs text-muted-foreground">{periodLabel(row)}</span>
                {row.note && <span className="basis-full break-words text-xs text-muted-foreground">{row.note}</span>}
                <span className="ml-auto flex gap-1">
                  {last && row.effectiveTo === null && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t(`${A}.endLabel`, { client: row.clientLabel, duration: durationLabel(row.duration) })}
                      onClick={(event) => {
                        trigger.current = event.currentTarget
                        setToEnd(row)
                      }}
                    >
                      {t(`${A}.end`)}
                    </Button>
                  )}
                  {canDeleteDated(row, series, today, now, { keepFirst: false }) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t(`${A}.deleteLabel`, { client: row.clientLabel, duration: durationLabel(row.duration), date: formatDateOnlyShort(row.effectiveFrom) })}
                      onClick={(event) => {
                        trigger.current = event.currentTarget
                        setRefusal(null)
                        setToDelete(row)
                      }}
                    >
                      <Trash2 aria-hidden className="sm:hidden" />
                      <span className="max-sm:sr-only">{t(`${W}.delete`)}</span>
                    </Button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <EndAgreementDialog professionalId={professionalId} row={toEnd} today={today} onClose={() => setToEnd(null)} triggerRef={trigger} fallbackRef={addButton} />
      <ConfirmDeleteDialog
        open={toDelete !== null}
        title={t(`${A}.deleteTitle`)}
        body={toDelete ? t(`${A}.deleteBody`, { client: toDelete.clientLabel, duration: durationLabel(toDelete.duration), date: formatDateOnlyShort(toDelete.effectiveFrom) }) : ''}
        pending={remove.isPending}
        refusal={refusal}
        onConfirm={() => {
          if (!toDelete) return
          setRefusal(null)
          remove.mutate(toDelete.id, { onSuccess: () => setToDelete(null) })
        }}
        onOpenChange={(next) => {
          if (next) return
          remove.reset()
          setToDelete(null)
        }}
        triggerRef={trigger}
        fallbackRef={addButton}
      />
    </section>
  )
}

// --- « Nouvelle entente » -------------------------------------------------------------------------------

const AgreementDialog = forwardRef<HTMLButtonElement, { professionalId: string }>(function AgreementDialog({ professionalId }, ref) {
  const [open, setOpen] = useState(false)
  const { refusal, dateError, feedback, clear } = useDialogRefusal()
  const save = useSetClientAgreement(professionalId, feedback)
  const firstField = useRef<HTMLInputElement | null>(null)

  const onOpenChange = (next: boolean) => {
    if (save.isPending) return
    if (!next) {
      save.reset()
      clear()
    }
    setOpen(next)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button ref={ref} type="button" variant="outline" size="sm">
          <Plus aria-hidden />
          {t(`${A}.add`)}
        </Button>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          firstField.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(`${A}.dialog.title`)}</DialogTitle>
          <DialogDescription>{t(`${A}.dialog.description`)}</DialogDescription>
        </DialogHeader>
        <AgreementForm
          firstFieldRef={firstField}
          pending={save.isPending}
          refusal={refusal}
          dateError={dateError}
          onSubmit={(input) => {
            clear()
            save.mutate(input, { onSuccess: () => setOpen(false) })
          }}
        />
      </DialogContent>
    </Dialog>
  )
})

interface AgreementFormProps {
  firstFieldRef: RefObject<HTMLInputElement | null>
  pending: boolean
  refusal: string | null
  dateError: DateError | null
  onSubmit: (input: AgreementInput) => void
}

function AgreementForm({ firstFieldRef, pending, refusal, dateError, onSubmit }: AgreementFormProps) {
  const resolver = useMemo(() => zodResolver(agreementSchema()), [])
  const form = useForm<AgreementFormValues, unknown, AgreementInput>({
    resolver,
    defaultValues: { clientLabel: '', duration: '50', professionalAmount: '', clientPrice: '', effectiveFrom: '', note: '' },
  })
  const { errors, isDirty } = form.formState
  useDateErrorOnField(form.setError, 'effectiveFrom', dateError)
  const effectiveFrom = useWatch({ control: form.control, name: 'effectiveFrom' })
  const { ref: labelRef, ...labelField } = form.register('clientLabel')

  return (
    <DialogForm onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} pending={pending} dirty={isDirty} refusal={refusal}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t(`${A}.dialog.client`)} help={t(`${A}.dialog.clientHelp`)} required error={errors.clientLabel?.message}>
          {(field) => (
            <Input
              {...field}
              {...labelField}
              ref={(element) => {
                labelRef(element)
                firstFieldRef.current = element
              }}
              autoComplete="off"
              maxLength={40}
            />
          )}
        </FormField>
        <FormField label={t(`${A}.dialog.duration`)} required error={errors.duration?.message}>
          {(field) => (
            <Select {...field} {...form.register('duration')}>
              {DURATIONS.map((duration) => (
                <option key={duration} value={String(duration)}>
                  {durationLabel(duration)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t(`${A}.dialog.clientPrice`)} required error={errors.clientPrice?.message}>
          {(field) => <Input {...field} {...form.register('clientPrice')} inputMode="decimal" autoComplete="off" />}
        </FormField>
        <FormField label={t(`${A}.dialog.professionalAmount`)} help={t(`${A}.dialog.professionalAmountHelp`)} required error={errors.professionalAmount?.message}>
          {(field) => <Input {...field} {...form.register('professionalAmount')} inputMode="decimal" autoComplete="off" />}
        </FormField>
      </div>
      <EffectiveFromField registration={form.register('effectiveFrom')} value={effectiveFrom} error={errors.effectiveFrom?.message} min={null} help={t(`${A}.dialog.fromHelp`)} />
      <FormField label={t(`${W}.note`)} help={t(`${W}.noteHelp`)} error={errors.note?.message}>
        {(field) => <Input {...field} {...form.register('note')} autoComplete="off" maxLength={500} />}
      </FormField>
    </DialogForm>
  )
}

// --- « Mettre fin » ----------------------------------------------------------------------------------------

interface EndAgreementDialogProps {
  professionalId: string
  row: AgreementRow | null
  /** The clinic's date: the end may not be earlier. */
  today: string
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
  fallbackRef: RefObject<HTMLElement | null>
}

/** The agreement's last day + 1 (exclusive end, as every dated row): the grid applies from that day. */
function EndAgreementDialog({ professionalId, row, today, onClose, triggerRef, fallbackRef }: EndAgreementDialogProps) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const end = useEndClientAgreement(professionalId, { onErrorMessage: (message) => setRefusal(message) })
  const minDate = row ? shiftCalendarDay(row.effectiveFrom, 1) : '2000-01-02'
  const resolver = useMemo(() => zodResolver(agreementEndSchema(minDate, today)), [minDate, today])
  const form = useForm<{ effectiveTo: string }>({ resolver, values: { effectiveTo: '' } })

  const onOpenChange = (next: boolean) => {
    if (next || end.isPending) return
    end.reset()
    setRefusal(null)
    form.reset()
    onClose()
  }

  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const trigger = triggerRef.current
          ;(trigger?.isConnected ? trigger : fallbackRef.current)?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(`${A}.endDialog.title`)}</DialogTitle>
          <DialogDescription>{row ? t(`${A}.endDialog.description`, { client: row.clientLabel, duration: durationLabel(row.duration) }) : ''}</DialogDescription>
        </DialogHeader>
        <DialogForm
          onSubmit={(event) =>
            void form.handleSubmit(({ effectiveTo }) => {
              if (!row) return
              setRefusal(null)
              end.mutate({ rowId: row.id, effectiveTo }, { onSuccess: () => onOpenChange(false) })
            })(event)
          }
          pending={end.isPending}
          dirty={form.formState.isDirty}
          refusal={refusal}
          submitLabel={t(`${A}.end`)}
          pendingLabel={t(`${A}.ending`)}
        >
          <FormField label={t(`${A}.endDialog.to`)} help={t(`${A}.endDialog.toHelp`)} required error={form.formState.errors.effectiveTo?.message}>
            {(field) => <Input {...field} {...form.register('effectiveTo')} type="date" min={minDate > today ? minDate : today} max={LAST_DATE} />}
          </FormField>
        </DialogForm>
      </DialogContent>
    </Dialog>
  )
}

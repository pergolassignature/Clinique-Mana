import { useState, type FormEvent } from 'react'
import { CircleAlert, Plus, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { SaveButton } from '@/shared/components/SaveButton'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import type { AgendaReference } from '../api/agenda'
import { EXCEPTION_KINDS, type AvailabilityException, type AvailabilityRule, type ExceptionKind } from '../api/parse'
import { useAddException, useDeleteAvailabilityRule, useRemoveException, useSaveAvailabilityRule } from '../hooks/use-agenda'
import { exceptionKindLabel, servicesFor, weekdayLabel } from '../lib/display'
import { addDays, instantOf } from '../lib/time'

const D = 'modules.appointments.availability'

function Refusal({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden />
      <AlertDescription className="text-foreground">{message}</AlertDescription>
    </Alert>
  )
}

export type RuleTarget = { rule: AvailabilityRule } | { professionalId: string; weekday: number; startTime: string }

/**
 * A weekly window (plan R2, availability mode): the weekday, the local start and end, the
 * services allowed (none ticked: every service the professional offers), « Visible aux clients »,
 * « Dépassement permis », the validity. « Supprimer » for an existing one. The database refuses
 * an overlap on the same weekday.
 */
export function RuleDialog({ target, reference, onClose }: { target: RuleTarget; reference: AgendaReference; onClose: () => void }) {
  const existing = 'rule' in target ? target.rule : null
  const professionalId = existing?.professionalId ?? (target as { professionalId: string }).professionalId
  const [weekday, setWeekday] = useState(existing?.weekday ?? (target as { weekday: number }).weekday)
  const [start, setStart] = useState(existing?.startTime ?? (target as { startTime: string }).startTime)
  const [end, setEnd] = useState(existing?.endTime ?? '17:00')
  const [serviceIds, setServiceIds] = useState<string[]>(existing?.serviceIds ?? [])
  const [visible, setVisible] = useState(existing?.visibleToClients ?? true)
  const [overflow, setOverflow] = useState(existing?.overflowAllowed ?? false)
  const [validFrom, setValidFrom] = useState(existing?.validFrom ?? '')
  const [validUntil, setValidUntil] = useState(existing?.validUntil ?? '')
  const [refusal, setRefusal] = useState<string | null>(null)
  const save = useSaveAvailabilityRule({ onErrorMessage: (m) => setRefusal(m) })
  const remove = useDeleteAvailabilityRule({ onErrorMessage: (m) => setRefusal(m) })
  const services = servicesFor(reference, professionalId)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setRefusal(null)
    save.mutate(
      {
        id: existing?.id ?? null,
        professionalId,
        weekday,
        startTime: start,
        endTime: end,
        serviceIds,
        visibleToClients: visible,
        overflowAllowed: overflow,
        validFrom: validFrom || null,
        validUntil: validUntil || null,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(existing ? `${D}.editTitle` : `${D}.newTitle`)}</DialogTitle>
          <DialogDescription>{t(`${D}.ruleDescription`)}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <FormRow>
            <FormField label={t(`${D}.weekday`)} width="sm" required>
              {(field) => (
                <Select {...field} value={String(weekday)} onChange={(e) => setWeekday(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <option key={d} value={d}>
                      {weekdayLabel(d)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label={t(`${D}.start`)} width="xs" required>
              {(field) => <Input {...field} type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} />}
            </FormField>
            <FormField label={t(`${D}.end`)} width="xs" required>
              {(field) => <Input {...field} type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} />}
            </FormField>
          </FormRow>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-medium">{t(`${D}.services`)}</legend>
            <p className="text-xs text-muted-foreground">{t(`${D}.servicesHelp`)}</p>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {services.map((s) => (
                <CheckboxField
                  key={s.id}
                  label={`${s.code} · ${s.name}`}
                  checked={serviceIds.includes(s.id)}
                  onCheckedChange={(v) => setServiceIds((ids) => (v === true ? [...ids, s.id] : ids.filter((id) => id !== s.id)))}
                />
              ))}
            </div>
          </fieldset>
          <CheckboxField label={t(`${D}.visible`)} checked={visible} onCheckedChange={(v) => setVisible(v === true)} />
          <CheckboxField label={t(`${D}.overflow`)} help={t(`${D}.overflowHelp`)} checked={overflow} onCheckedChange={(v) => setOverflow(v === true)} />
          <FormRow>
            <FormField label={t(`${D}.validFrom`)} width="sm" help={t(`${D}.validFromHelp`)}>
              {(field) => <Input {...field} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />}
            </FormField>
            <FormField label={t(`${D}.validUntil`)} width="sm">
              {(field) => <Input {...field} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}
            </FormField>
          </FormRow>
          <Refusal message={refusal} />
          <DialogFooter>
            {existing && (
              <Button type="button" variant="ghost" className="mr-auto" disabled={remove.isPending} onClick={() => remove.mutate(existing.id, { onSuccess: onClose })}>
                <Trash2 aria-hidden />
                {t(`${D}.delete`)}
              </Button>
            )}
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <SaveButton pending={save.isPending} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The professional's exceptions (holiday, vacation, other) beside the grid in availability
 * mode: the coming ones with « Retirer », « Ajouter une exception », and « Vacances cette
 * semaine » for the week shown (Monday 0:00 to the next Monday 0:00, clinic time).
 */
export function ExceptionsPanel({ professionalId, weekStart, exceptions }: { professionalId: string; weekStart: string; exceptions: readonly AvailabilityException[] }) {
  const [adding, setAdding] = useState(false)
  const add = useAddException()
  const remove = useRemoveException()
  const now = new Date().toISOString()
  const coming = exceptions.filter((e) => e.professionalId === professionalId && e.endsAt > now)
  return (
    <SettingsCard
      as="section"
      title={t(`${D}.exceptions`)}
      description={t(`${D}.exceptionsHelp`)}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={add.isPending}
            onClick={() =>
              add.mutate({ professionalId, kind: 'vacation', startsAt: instantOf(weekStart, 0), endsAt: instantOf(addDays(weekStart, 7), 0), label: null })
            }
          >
            {t(`${D}.vacationWeek`)}
          </Button>
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t(`${D}.addException`)}
          </Button>
        </div>
      }
    >
      {coming.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${D}.noException`)}</p>
      ) : (
        <ul className="divide-y divide-border">
          {coming.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-medium">{exceptionKindLabel(e.kind)}</span>
                {e.label && <span> · {e.label}</span>}
                <span className="block text-xs text-muted-foreground">
                  {formatClinicDateTime(e.startsAt)} – {formatClinicDateTime(e.endsAt)}
                </span>
              </span>
              <Button type="button" variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(e.id)}>
                {t(`${D}.removeException`)}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding && <ExceptionDialog professionalId={professionalId} weekStart={weekStart} onClose={() => setAdding(false)} />}
    </SettingsCard>
  )
}

function ExceptionDialog({ professionalId, weekStart, onClose }: { professionalId: string; weekStart: string; onClose: () => void }) {
  const [kind, setKind] = useState<ExceptionKind>('holiday')
  const [fromDay, setFromDay] = useState(weekStart)
  const [fromTime, setFromTime] = useState('00:00')
  const [toDay, setToDay] = useState(addDays(weekStart, 1))
  const [toTime, setToTime] = useState('00:00')
  const [label, setLabel] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const add = useAddException({ onErrorMessage: (m) => setRefusal(m) })
  const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(`${D}.addException`)}</DialogTitle>
          <DialogDescription>{t(`${D}.exceptionDescription`)}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            setRefusal(null)
            add.mutate(
              {
                professionalId,
                kind,
                startsAt: instantOf(fromDay, toMinutes(fromTime)),
                endsAt: instantOf(toDay, toMinutes(toTime)),
                label: label.trim() || null,
              },
              { onSuccess: onClose },
            )
          }}
        >
          <FormField label={t(`${D}.kind`)} width="sm" required>
            {(field) => (
              <Select {...field} value={kind} onChange={(e) => setKind(e.target.value as ExceptionKind)}>
                {EXCEPTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {exceptionKindLabel(k)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormRow>
            <FormField label={t(`${D}.from`)} width="sm" required>
              {(field) => <Input {...field} type="date" value={fromDay} onChange={(e) => setFromDay(e.target.value)} />}
            </FormField>
            <FormField label={t(`${D}.fromTime`)} width="xs">
              {(field) => <Input {...field} type="time" step={300} value={fromTime} onChange={(e) => setFromTime(e.target.value)} />}
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label={t(`${D}.to`)} width="sm" required>
              {(field) => <Input {...field} type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} />}
            </FormField>
            <FormField label={t(`${D}.toTime`)} width="xs">
              {(field) => <Input {...field} type="time" step={300} value={toTime} onChange={(e) => setToTime(e.target.value)} />}
            </FormField>
          </FormRow>
          <FormField label={t(`${D}.label`)} width="full">
            {(field) => <Input {...field} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />}
          </FormField>
          <Refusal message={refusal} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <SaveButton pending={add.isPending} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

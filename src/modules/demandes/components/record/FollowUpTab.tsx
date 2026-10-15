import { useState, type FormEvent } from 'react'
import { t } from '@/i18n'
import { demandesError } from '../../lib/errors'
import { FormActions } from '@/shared/components/FormActions'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { clinicTimeToUTC, formatClinicDateTime, getClinicDateString, isClinicToday, shiftCalendarDay } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { toast } from '@/shared/ui/sonner'
import { StatusDot } from '@/shared/ui/status-dot'
import { DateField } from '@/shared/ui/date-field'
import { TimeField } from '@/shared/ui/time-field'
import { TASK_KINDS, TASK_OUTCOMES, type DemandeTask, type TaskKind, type TaskOutcome } from '../../api/demandes'
import { useAddTask, useCancelTask, useCompleteTask, useSaveNote } from '../../hooks/use-demandes'
import { optionLabel, personLabel } from '../../lib/display'
import { LogContactDialog } from '../LogContactDialog'
import { useServerDraft } from '../../lib/use-server-draft'
import { useDemandeRecord } from './record-context'
import { StaleNotice } from './StaleNotice'
import { PropositionsCard } from './PropositionsCard'
import { WaitlistCard } from './WaitlistCard'

const F = 'modules.demandes.followUp'

/**
 * « Suivi »: the contact attempts (how many, the last, the next try, « Noter un appel »), the
 * dated tasks (the discovery call replaces the fake « conseillère » appointments; a callback; a
 * follow-up), the proposals (D3b), the waiting list's entries (D3) and the internal note (demandes.notes only; never in a journal, a notice or an AI
 * prompt, D-4).
 */
export function FollowUpTab() {
  const { bundle } = useDemandeRecord()
  return (
    <SectionSurface>
      <ContactsCard />
      <PropositionsCard />
      <WaitlistCard />
      <TasksCard />
      {bundle.can.notes && <NoteCard />}
    </SectionSurface>
  )
}

function ContactsCard() {
  const { id, bundle, canEdit } = useDemandeRecord()
  const d = bundle.demande
  return (
    <SettingsCard as="section" layout="section" title={t(`${F}.contacts.title`)} description={t(`${F}.contacts.description`)}>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">{t(`${F}.contacts.attempts`)}</dt>
        <dd className="tabular">{d.contact_attempts}</dd>
        <dt className="text-muted-foreground">{t(`${F}.contacts.last`)}</dt>
        <dd>
          {d.last_contact_at
            ? `${formatClinicDateTime(d.last_contact_at)}${d.last_outcome ? ` · ${optionLabel('outcome', d.last_outcome)}` : ''}`
            : t(`${F}.contacts.never`)}
        </dd>
        <dt className="text-muted-foreground">{t(`${F}.contacts.next`)}</dt>
        <dd>{d.next_contact_at ? formatClinicDateTime(d.next_contact_at) : t(`${F}.contacts.noNext`)}</dd>
      </dl>
      {canEdit && <LogContactDialog demandeId={id} person={personLabel(d)} />}
    </SettingsCard>
  )
}

function TasksCard() {
  const { bundle, canEdit } = useDemandeRecord()
  const open = bundle.tasks.filter((k) => k.state === 'open')
  const done = bundle.tasks.filter((k) => k.state !== 'open')
  return (
    <SettingsCard as="section" layout="section" title={t(`${F}.tasks.title`)} description={t(`${F}.tasks.description`)}>
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${F}.tasks.none`)}</p>
      ) : (
        <ul aria-label={t(`${F}.tasks.open`)} className="divide-y divide-border-light">
          {open.map((task) => (
            <OpenTask key={task.id} task={task} canEdit={canEdit} />
          ))}
        </ul>
      )}
      {canEdit && <AddTaskForm />}
      {done.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t(`${F}.tasks.doneCount`, { count: String(done.length) })}</summary>
          <ul className="mt-2 space-y-1">
            {done.map((task) => (
              <li key={task.id} className="text-muted-foreground">
                {t(task.state === 'done' ? `${F}.tasks.doneLine` : `${F}.tasks.cancelledLine`, {
                  kind: optionLabel('taskKind', task.kind),
                  date: task.done_at ? formatClinicDateTime(task.done_at) : formatClinicDateTime(task.due_at),
                  outcome: task.outcome ? optionLabel('taskOutcome', task.outcome) : '',
                  name: task.done_by_name ?? '',
                })}
              </li>
            ))}
          </ul>
        </details>
      )}
    </SettingsCard>
  )
}

function OpenTask({ task, canEdit }: { task: DemandeTask; canEdit: boolean }) {
  const { id } = useDemandeRecord()
  const complete = useCompleteTask(id)
  const cancel = useCancelTask(id)
  const [outcome, setOutcome] = useState<TaskOutcome>('reached')
  const overdue = Date.parse(task.due_at) < Date.now()
  const pending = complete.isPending || cancel.isPending
  const kind = optionLabel('taskKind', task.kind)
  const onError = (error: unknown) => toast.error(demandesError(error))
  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <StatusDot tone={overdue ? 'error' : isClinicToday(task.due_at) ? 'warning' : 'default'} />
        <span className="font-medium">{kind}</span>
        <span className="tabular">{formatClinicDateTime(task.due_at)}</span>
        {overdue && <span className="text-destructive">{t(`${F}.tasks.overdue`)}</span>}
        {task.assigned_name && <span className="text-muted-foreground">{t(`${F}.tasks.for`, { name: task.assigned_name })}</span>}
      </p>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor={`outcome-${task.id}`} className="text-xs text-muted-foreground">
              {t(`${F}.tasks.outcome`)}
            </label>
            <Select id={`outcome-${task.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value as TaskOutcome)} className="w-52">
              {TASK_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {optionLabel('taskOutcome', o)}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            aria-label={t(`${F}.tasks.doneLabel`, { kind })}
            aria-disabled={pending || undefined}
            onClick={ignoreWhenInactive(pending, () => complete.mutate({ taskId: task.id, outcome }, { onError }))}
            className={cn(softDisabledClasses, 'max-sm:h-11')}
          >
            {t(`${F}.tasks.done`)}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t(`${F}.tasks.cancelLabel`, { kind })}
            aria-disabled={pending || undefined}
            onClick={ignoreWhenInactive(pending, () => cancel.mutate(task.id, { onError }))}
            className={cn(softDisabledClasses, 'max-sm:h-11')}
          >
            {t(`${F}.tasks.cancel`)}
          </Button>
        </div>
      )}
    </li>
  )
}

function AddTaskForm() {
  const { id, reference } = useDemandeRecord()
  const add = useAddTask(id)
  const [kind, setKind] = useState<TaskKind>('discovery_call')
  const [date, setDate] = useState(() => shiftCalendarDay(getClinicDateString(new Date()), 1))
  const [time, setTime] = useState('10:00')
  const [assignee, setAssignee] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (add.isPending) return
    setError(null)
    if (!date || !time) {
      setError(t(`${F}.tasks.whenNeeded`))
      return
    }
    add.mutate(
      { kind, dueAt: clinicTimeToUTC(date, time), assignee: assignee || null },
      { onSuccess: () => toast.success(t(`${F}.tasks.added`)), onError: (failure) => setError(demandesError(failure)) },
    )
  }
  return (
    <form onSubmit={submit} noValidate aria-label={t(`${F}.tasks.addLabel`)} className="space-y-2 border-t border-border-light pt-3">
      <FormRow>
        <FormField label={t(`${F}.tasks.kind`)}>
          {(field) => (
            <Select {...field} value={kind} onChange={(e) => setKind(e.target.value as TaskKind)}>
              {TASK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {optionLabel('taskKind', k)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t(`${F}.tasks.date`)}>{(field) => <DateField {...field} value={date} onChange={setDate} />}</FormField>
        <FormField label={t(`${F}.tasks.time`)}>{(field) => <TimeField {...field} value={time} onChange={setTime} />}</FormField>
        <FormField label={t(`${F}.tasks.assignee`)}>
          {(field) => (
            <Select {...field} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">{t(`${F}.tasks.anyone`)}</option>
              {reference.workers.map((w) => (
                <option key={w.user_id} value={w.user_id}>
                  {w.display_name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </FormRow>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" aria-disabled={add.isPending || undefined} className="max-sm:h-11">
        {add.isPending ? t(`${F}.tasks.adding`) : t(`${F}.tasks.add`)}
      </Button>
    </form>
  )
}

function NoteCard() {
  const { id, bundle, canEdit } = useDemandeRecord()
  const draft = useServerDraft(bundle.note?.internal_note ?? '')
  const { values: note, setValues: setNote, dirty } = draft
  const [error, setError] = useState<string | null>(null)
  const save = useSaveNote(id)
  useUnsavedChanges(dirty)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (save.isPending || !dirty) return
    setError(null)
    save.mutate(note, {
      onSuccess: () => {
        draft.commit()
        toast.success(t(`${F}.note.saved`))
      },
      onError: (failure) => setError(demandesError(failure)),
    })
  }
  return (
    <SettingsCard as="section" layout="section" title={t(`${F}.note.title`)} description={t(`${F}.note.description`)}>
      <form onSubmit={submit} noValidate className="space-y-2">
        {draft.stale && <StaleNotice onReload={draft.reload} />}
        <FormField
          label={t(`${F}.note.label`)}
          help={bundle.note ? t(`${F}.note.updated`, { date: formatClinicDateTime(bundle.note.updated_at), name: bundle.note.updated_by_name ?? '' }) : undefined}
        >
          {(field) => <Textarea {...field} value={note} onChange={(e) => setNote(e.target.value)} readOnly={!canEdit} rows={5} />}
        </FormField>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {canEdit && (
          <div className="flex justify-end gap-2 empty:hidden">
            <FormActions onCancel={draft.reset} dirty={dirty} pending={save.isPending} />
          </div>
        )}
      </form>
    </SettingsCard>
  )
}

import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { formatPhone } from '@/shared/lib/format'
import { clinicTimeToUTC, formatClinicTime, formatInClinicTimezone, getClinicDateString, shiftCalendarDay } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { DateField } from '@/shared/ui/date-field'
import { TimeField } from '@/shared/ui/time-field'
import type { CallsPeriod, DiscoveryCall } from '../api/calls'
import type { DemandesReference } from '../api/demandes'
import { useAssignTask, useDiscoveryCalls, useRescheduleTask } from '../hooks/use-calls'
import { useCancelTask, useCompleteTask, useDemandesRealtime, useDemandesReference } from '../hooks/use-demandes'
import { demandePath, optionLabel, personLabel } from '../lib/display'
import { demandesError } from '../lib/errors'

const C = 'modules.demandes.calls'
const VIEWS = ['today', 'tomorrow', 'week'] as const
type View = (typeof VIEWS)[number]
const VIEW_PARAM: Record<View, string> = { today: 'aujourdhui', tomorrow: 'demain', week: 'semaine' }

/** The view's period in the clinic's days; today also brings the calls not made yet. */
function periodOf(view: View, today: string): CallsPeriod {
  const start = view === 'tomorrow' ? shiftCalendarDay(today, 1) : today
  const days = view === 'week' ? 7 : 1
  return { from: clinicTimeToUTC(start, '00:00'), to: clinicTimeToUTC(shiftCalendarDay(start, days), '00:00'), overdue: view === 'today' }
}

/**
 * « Appels découverte » (plan §10 D3b, D-20): the counselors' calls of the day, of tomorrow or of
 * the week — instead of the fake appointments of the shared « conseillère » agenda. Each call: the
 * time, the person and the number to call, booked on the page or not, who calls; « Jointe », « Pas
 * de réponse », « Reporter… », « Annuler ». Today also lists the calls not made since. Live with the
 * other counselors.
 */
export function DiscoveryCallsPage() {
  usePageTitle(t(`${C}.title`))
  useDemandesRealtime(true)
  const { can } = useAccess()
  const [params, setParams] = useSearchParams()
  const view = (Object.entries(VIEW_PARAM) as [View, string][]).find(([, v]) => v === params.get('vue'))?.[0] ?? 'today'
  const [today] = useState(() => getClinicDateString(new Date()))
  const period = useMemo(() => periodOf(view, today), [view, today])
  const calls = useDiscoveryCalls(period)
  const reference = useDemandesReference()
  const canManage = can('demandes.manage')

  return (
    <>
      <PageHeader level={1} title={t(`${C}.title`)} description={t(`${C}.description`)} />
      <Tabs value={view} onValueChange={(next) => setParams(next === 'today' ? {} : { vue: VIEW_PARAM[next as View] }, { replace: true })}>
        <TabsList aria-label={t(`${C}.views`)}>
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`${C}.view.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={view} className="mt-4">
          {calls.isError && !calls.data ? (
            <LoadError message={t(`${C}.loadError`)} onRetry={() => void calls.refetch()} retrying={calls.isFetching} />
          ) : !calls.data ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('common.loading')}
            </p>
          ) : calls.data.length === 0 ? (
            <EmptyState title={t(`${C}.empty.${view}`)} body={t(`${C}.emptyBody`)} />
          ) : (
            <CallsByDay calls={calls.data} today={today} canManage={canManage} reference={reference.data ?? null} />
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}

function CallsByDay({ calls, today, canManage, reference }: { calls: DiscoveryCall[]; today: string; canManage: boolean; reference: DemandesReference | null }) {
  const days = new Map<string, DiscoveryCall[]>()
  for (const call of calls) {
    const day = getClinicDateString(call.due_at)
    // A call not made from an earlier day is listed with today's, marked « En retard ».
    const key = day < today && call.state === 'open' ? today : day
    days.set(key, [...(days.get(key) ?? []), call])
  }
  return (
    <div className="space-y-6">
      {[...days.entries()].map(([day, list]) => {
        const label = formatInClinicTimezone(clinicTimeToUTC(day, '12:00'), 'EEEE d MMMM')
        return (
          <section key={day} aria-label={label} className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground first-letter:uppercase">{label}</h2>
            <ul className="divide-y divide-border-light rounded-lg border border-border bg-card">
              {list.map((call) => (
                <CallRow key={call.task_id} call={call} today={today} canManage={canManage} reference={reference} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function CallRow({ call, today, canManage, reference }: { call: DiscoveryCall; today: string; canManage: boolean; reference: DemandesReference | null }) {
  const person = personLabel(call)
  const open = call.state === 'open'
  const late = open && getClinicDateString(call.due_at) < today
  const complete = useCompleteTask(call.demande_id)
  const cancel = useCancelTask(call.demande_id)
  const assign = useAssignTask(call.demande_id)
  const [moving, setMoving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const busy = complete.isPending || cancel.isPending
  const done = (outcome: 'reached' | 'no_answer') => {
    if (busy) return
    complete.mutate(
      { taskId: call.task_id, outcome },
      { onSuccess: () => toast.success(t(`${C}.done`, { person })), onError: (error) => toast.error(demandesError(error)) },
    )
  }

  return (
    <li className={cn('flex flex-wrap items-start gap-x-4 gap-y-2 p-3', !open && 'text-muted-foreground')}>
      <p className="tabular w-16 shrink-0 pt-0.5 text-sm font-medium">{formatClinicTime(call.due_at)}</p>
      <div className="min-w-0 flex-1 basis-48 space-y-0.5">
        <p className="flex flex-wrap items-center gap-2">
          <Link to={demandePath(call.demande_id, 'suivi')} className="font-medium text-link underline-offset-2 hover:underline">
            {person}
          </Link>
          {late && <Badge variant="error">{t(`${C}.late`)}</Badge>}
          {call.is_urgent && <Badge variant="error">{t(`${C}.urgent`)}</Badge>}
          {call.booked_online && <Badge variant="info">{t(`${C}.bookedOnline`)}</Badge>}
        </p>
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span className="tabular">{call.reference}</span>
          {call.phone_e164 ? (
            <a href={`tel:${call.phone_e164}`} className="tabular text-link underline-offset-2 hover:underline">
              {formatPhone(call.phone_e164)}
            </a>
          ) : (
            <span>{t(`${C}.noPhone`)}</span>
          )}
          {call.language === 'en' && <span>{t(`${C}.english`)}</span>}
        </p>
        {!open && (
          <p className="text-xs">
            {t(`${C}.doneLine`, { outcome: call.outcome ? optionLabel('taskOutcome', call.outcome) : '', name: call.done_by_name ?? '' })}
          </p>
        )}
      </div>
      {open && canManage && reference ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t(`${C}.whoFor`, { person })}
            value={call.assigned_to ?? ''}
            disabled={assign.isPending}
            onChange={(e) =>
              assign.mutate({ taskId: call.task_id, assignee: e.target.value || null }, { onError: (error) => toast.error(demandesError(error)) })
            }
            className="w-44"
          >
            <option value="">{t(`${C}.anyone`)}</option>
            {reference.workers.map((w) => (
              <option key={w.user_id} value={w.user_id}>
                {w.display_name}
              </option>
            ))}
          </Select>
          <Button type="button" size="sm" aria-disabled={busy || undefined} onClick={() => done('reached')} className="max-sm:h-11">
            {t(`${C}.reached`)}
          </Button>
          <Button type="button" variant="outline" size="sm" aria-disabled={busy || undefined} onClick={() => done('no_answer')} className="max-sm:h-11">
            {t(`${C}.noAnswer`)}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setMoving(true)} aria-label={t(`${C}.moveFor`, { person })} className="max-sm:h-11">
            {t(`${C}.move`)}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setCancelling(true)} aria-label={t(`${C}.cancelFor`, { person })} className="max-sm:h-11">
            {t(`${C}.cancel`)}
          </Button>
          <MoveDialog call={call} person={person} open={moving} onOpenChange={setMoving} />
          <AlertDialog open={cancelling} onOpenChange={setCancelling}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t(`${C}.cancelTitle`, { person })}</AlertDialogTitle>
                <AlertDialogDescription>{t(call.booked_online ? `${C}.cancelBodyOnline` : `${C}.cancelBody`)}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    cancel.mutate(call.task_id, {
                      onSuccess: () => toast.success(t(`${C}.cancelled`)),
                      onError: (error) => toast.error(demandesError(error)),
                    })
                  }
                >
                  {t(`${C}.cancelAction`)}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : (
        open && call.assigned_name && <p className="text-xs text-muted-foreground">{t(`${C}.assignedTo`, { name: call.assigned_name })}</p>
      )}
    </li>
  )
}

function MoveDialog({ call, person, open, onOpenChange }: { call: DiscoveryCall; person: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}>{open && <MoveForm call={call} person={person} onDone={() => onOpenChange(false)} />}</Dialog>
}

function MoveForm({ call, person, onDone }: { call: DiscoveryCall; person: string; onDone: () => void }) {
  const reschedule = useRescheduleTask(call.demande_id)
  const [date, setDate] = useState(() => shiftCalendarDay(getClinicDateString(new Date()), 1))
  const [time, setTime] = useState(() => formatInClinicTimezone(call.due_at, 'HH:mm'))
  const [error, setError] = useState<string | null>(null)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (reschedule.isPending || !date || !time) return
    setError(null)
    reschedule.mutate(
      { taskId: call.task_id, dueAt: clinicTimeToUTC(date, time) },
      {
        onSuccess: () => {
          toast.success(t(`${C}.moved`))
          onDone()
        },
        onError: (failure) => setError(demandesError(failure)),
      },
    )
  }
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t(`${C}.moveTitle`, { person })}</DialogTitle>
        <DialogDescription>{t(call.booked_online ? `${C}.moveBodyOnline` : `${C}.moveBody`)}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} noValidate className="space-y-3">
        <FormRow>
          <FormField label={t(`${C}.date`)}>{(field) => <DateField {...field} value={date} onChange={setDate} />}</FormField>
          <FormField label={t(`${C}.time`)}>{(field) => <TimeField {...field} value={time} onChange={setTime} />}</FormField>
        </FormRow>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="submit" aria-disabled={reschedule.isPending || undefined}>
            {t(`${C}.moveSave`)}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

import { Suspense, useMemo, useState, type FormEvent } from 'react'
import { CircleAlert, TriangleAlert, X } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { rpcErrorHint } from '@/core/modules/errors'
import { ModuleSlotTargetContext, useModuleSlot } from '@/core/modules/slots'
import { useConfirmLeave, useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { ClientPicker, type PickedClient } from '@/modules/clients'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { Loading } from '@/shared/components/LoadState'
import { RouteBoundary } from '@/shared/components/RouteBoundary'
import { softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { SaveButton } from '@/shared/components/SaveButton'
import { formatClinicDateFull, formatClinicTime, getClinicDateString, getClinicTimeString, clinicTimeToUTC } from '@/shared/lib/timezone'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { NavTab, NavTabs } from '@/shared/ui/nav-tabs'
import { closeButtonClasses } from '@/shared/ui/overlay-classes'
import { Select } from '@/shared/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { Textarea } from '@/shared/ui/textarea'
import { DateField } from '@/shared/ui/date-field'
import { TimeField } from '@/shared/ui/time-field'
import type { AgendaReference, SeriesRule } from '../api/agenda'
import { MODES, PRESENCES, type AgendaAppointment, type AppointmentMode, type Presence } from '../api/parse'
import {
  useAppointmentConsents,
  useAppointmentDetail,
  useBookAppointment,
  useBookingConsents,
  useCancelAppointment,
  useCancelSeriesFrom,
  useChangeService,
  useConfirmAppointment,
  useCreateSeries,
  useMoveAppointment,
  useRestoreAppointment,
  useSeriesPreview,
  useSetAppointmentDetails,
  useSetPresence,
} from '../hooks/use-agenda'
import { appointmentTitle, modeLabel, presenceLabel, servicesFor, stateBadgeVariant, stateLabel } from '../lib/display'
import { isoWeekday } from '../lib/time'
import { emptySeries, seriesComplete, seriesCount, type SeriesDraft } from '../lib/series'
import { AppointmentHistory } from './AppointmentHistory'
import { ConsentsNotice } from './ConsentsNotice'
import { SeriesFields } from './SeriesFields'
import { VideoSection } from './VideoSection'

const E = 'modules.appointments.editor'

export type SheetTarget =
  | { kind: 'create'; professionalId: string | null; day: string; time: string }
  /** `move`: a drag refused outside the availability, offered here with « Hors disponibilités » (AP-12). */
  | { kind: 'edit'; appointment: AgendaAppointment; move?: { startsAt: string } }

const OUTSIDE = 'outside_availability'


/**
 * The appointment editor (plan R2), a sheet: « Nouveau rendez-vous » (professional, service, date
 * and time, the client then a second person through Clients' picker, mode, internal note,
 * message to the client), or an appointment's tabs « Rendez-vous » (move, presence), « Notes »,
 * « Annulation » (in-sheet tabs, out of the tab order). The database checks every rule: a slot
 * outside the availability offers « Hors disponibilités » with a reason to the staff (AP-12), a
 * client with a balance the override to who holds it (R-58); every other refusal shows here.
 * Since the parity audit: « Changer le service » (AP-28), « Rétablir » (AP-29), « Marquer
 * confirmé » (AP-30), and the consents still to sign, at booking and on the appointment (AP-32).
 */
export function AppointmentSheet({ target, reference, onClose }: { target: SheetTarget; reference: AgendaReference; onClose: () => void }) {
  // A form with changes asks before the sheet closes (CLAUDE.md §8).
  const confirmLeave = useConfirmLeave()
  const close = () => confirmLeave(onClose)
  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent hideClose className="max-w-[560px]">
        <button type="button" tabIndex={-1} onClick={close} className={closeButtonClasses}>
          <X aria-hidden className="h-4 w-4" />
          <span className="sr-only">{t('common.close')}</span>
        </button>
        {target.kind === 'create' ? (
          <CreateForm target={target} reference={reference} onClose={onClose} />
        ) : (
          <EditPanel appointment={target.appointment} move={target.move} reference={reference} onClose={onClose} />
        )}
      </SheetContent>
    </Sheet>
  )
}

function OverrideFields({
  outside,
  balance,
  outsideReason,
  balanceReason,
  setOutsideReason,
  setBalanceReason,
}: {
  outside: boolean
  balance: boolean
  outsideReason: string
  balanceReason: string
  setOutsideReason: (v: string) => void
  setBalanceReason: (v: string) => void
}) {
  return (
    <>
      {outside && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertDescription className="space-y-2 text-foreground">
            <p className="font-medium">{t(`${E}.outsideTitle`)}</p>
            <p className="text-sm">{t(`${E}.outsideHelp`)}</p>
            <FormField label={t(`${E}.outsideReason`)} width="full" required>
              {(field) => <Input {...field} value={outsideReason} onChange={(e) => setOutsideReason(e.target.value)} maxLength={500} />}
            </FormField>
          </AlertDescription>
        </Alert>
      )}
      {balance && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertDescription className="space-y-2 text-foreground">
            <p className="font-medium">{t(`${E}.balanceTitle`)}</p>
            <FormField label={t(`${E}.balanceReason`)} width="full" required>
              {(field) => <Input {...field} value={balanceReason} onChange={(e) => setBalanceReason(e.target.value)} maxLength={500} />}
            </FormField>
          </AlertDescription>
        </Alert>
      )}
    </>
  )
}

function Refusal({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden />
      <AlertDescription className="text-foreground">{message}</AlertDescription>
    </Alert>
  )
}

function CreateForm({ target, reference, onClose }: { target: Extract<SheetTarget, { kind: 'create' }>; reference: AgendaReference; onClose: () => void }) {
  const { can } = useAccess()
  // From the all-professionals grid nobody is chosen for the person: she picks.
  const [professionalId, setProfessionalId] = useState(target.professionalId ?? '')
  const services = useMemo(() => (professionalId ? servicesFor(reference, professionalId) : []), [reference, professionalId])
  const [serviceId, setServiceId] = useState('')
  const [day, setDay] = useState(target.day)
  const [time, setTime] = useState(target.time)
  const [clients, setClients] = useState<PickedClient[]>([])
  const [mode, setMode] = useState<AppointmentMode>('video')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [outside, setOutside] = useState(false)
  const [balance, setBalance] = useState(false)
  const [outsideReason, setOutsideReason] = useState('')
  const [balanceReason, setBalanceReason] = useState('')
  const [series, setSeries] = useState<SeriesDraft>(() => emptySeries(isoWeekday(target.day)))
  const feedback = {
    onErrorMessage: (msg: string, error: unknown) => {
      const hint = rpcErrorHint(error)
      if (hint === OUTSIDE && can('appointments.manage')) setOutside(true)
      if (hint === 'balance_due' && can('appointments.balance_override')) setBalance(true)
      setRefusal(msg)
    },
  }
  const book = useBookAppointment(feedback)
  const createSeries = useCreateSeries(feedback)
  const consents = useBookingConsents(serviceId, clients.map((c) => c.id))
  const service = services.find((s) => s.id === serviceId)
  const needed = service?.forTwo ? 2 : 1
  // The series' rule once complete: its dates and conflicts come from the database.
  const rule: SeriesRule | null =
    series.repeat && professionalId && serviceId && day && time && seriesComplete(series)
      ? {
          professionalId,
          serviceId,
          firstStartsAt: clinicTimeToUTC(day, time),
          intervalWeeks: series.intervalWeeks,
          weekdays: series.weekdays,
          count: seriesCount(series),
          until: series.endKind === 'until' ? series.until : null,
        }
      : null
  const preview = useSeriesPreview(rule)
  const conflicts = preview.data?.filter((d) => d.conflict !== null).length ?? 0
  useUnsavedChanges(Boolean(serviceId || clients.length > 0 || note.trim() || message.trim() || series.repeat))
  const ready =
    Boolean(professionalId && serviceId && day && time && clients.length >= needed) &&
    (!series.repeat || (rule !== null && preview.data !== undefined && (conflicts === 0 || series.skipConflicts)))
  const pending = book.isPending || createSeries.isPending

  const submit = (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!ready || pending) return
    setRefusal(null)
    const shared = {
      clientIds: clients.map((c) => c.id),
      mode,
      internalNote: note.trim() || null,
      clientMessage: message.trim() || null,
      balanceOverrideReason: balance ? balanceReason.trim() || null : null,
      outsideAvailabilityReason: outside ? outsideReason.trim() || null : null,
    }
    if (rule) createSeries.mutate({ ...rule, ...shared, skipConflicts: series.skipConflicts }, { onSuccess: onClose })
    else book.mutate({ professionalId, serviceId, startsAt: clinicTimeToUTC(day, time), ...shared }, { onSuccess: onClose })
  }

  const addClient = (client: PickedClient) => setClients((list) => (list.some((c) => c.id === client.id) || list.length >= 2 ? list : [...list, client]))

  return (
    <form noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader>
        <SheetTitle>{t(`${E}.newTitle`)}</SheetTitle>
        <SheetDescription>{t(`${E}.newDescription`)}</SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-4">
        <FormRow>
          <FormField label={t(`${E}.professional`)} width="md" required>
            {(field) => (
              <Select {...field} value={professionalId} onChange={(e) => {
                setProfessionalId(e.target.value)
                setServiceId('')
              }} placeholder={t(`${E}.choose`)}>
                {reference.professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t(`${E}.service`)} width="md" required>
            {(field) => (
              <Select {...field} value={serviceId} onChange={(e) => setServiceId(e.target.value)} placeholder={t(`${E}.choose`)}>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        </FormRow>
        <FormRow>
          <FormField label={t(`${E}.date`)} width="sm" required>
            {(field) => <DateField {...field} value={day} onChange={setDay} />}
          </FormField>
          <FormField label={t(`${E}.time`)} width="sm" required help={service ? t(`${E}.slotHelp`, { duration: String(service.durationMinutes), buffer: String(service.bufferAfterMinutes) }) : undefined}>
            {(field) => <TimeField {...field} value={time} onChange={setTime} />}
          </FormField>
          <FormField label={t(`${E}.mode`)} width="sm">
            {(field) => (
              <Select {...field} value={mode} onChange={(e) => setMode(e.target.value as AppointmentMode)}>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {modeLabel(m)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        </FormRow>
        <SeriesFields draft={series} onChange={setSeries} preview={rule ? preview.data : undefined} loading={preview.isFetching} />
        <section className="space-y-2" aria-label={t(service?.forTwo ? `${E}.clientsTwo` : `${E}.clients`)}>
          {clients.length > 0 && (
            <ul className="space-y-1">
              {clients.map((c, i) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-sm">
                  <span>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-muted-foreground"> · {t(i === 0 ? `${E}.personSeen` : `${E}.secondPerson`)}</span>
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setClients((list) => list.filter((x) => x.id !== c.id))}>
                    {t(`${E}.removeClient`)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {clients.length < 2 && (
            <Suspense fallback={<Loading />}>
              <ClientPicker
                label={t(clients.length === 0 ? (service?.forTwo ? `${E}.clientsTwo` : `${E}.findClient`) : service?.forTwo ? `${E}.findSecondRequired` : `${E}.findSecond`)}
                excludeIds={clients.map((c) => c.id)}
                onSelect={(id, client) => addClient(client ?? { id, name: t(`${E}.newClientName`), clientNumber: 0 })}
              />
            </Suspense>
          )}
        </section>
        {serviceId && clients.length > 0 && (
          <ConsentsNotice consents={consents.data} failed={consents.isError} clientName={(id) => clients.find((c) => c.id === id)?.name ?? ''} />
        )}
        <FormField label={t(`${E}.internalNote`)} width="full" help={t(`${E}.internalNoteHelp`)}>
          {(field) => <Textarea {...field} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={5000} />}
        </FormField>
        <FormField label={t(`${E}.clientMessage`)} width="full" help={t(`${E}.clientMessageHelp`)}>
          {(field) => <Textarea {...field} value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={2000} />}
        </FormField>
        <OverrideFields
          outside={outside}
          balance={balance}
          outsideReason={outsideReason}
          balanceReason={balanceReason}
          setOutsideReason={setOutsideReason}
          setBalanceReason={setBalanceReason}
        />
        <Refusal message={refusal} />
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <SaveButton
          pending={pending}
          disabled={!ready}
          label={series.repeat ? t(`${E}.series.book`, { count: String(preview.data ? preview.data.length - (series.skipConflicts ? conflicts : 0) : 0) }) : t(`${E}.book`)}
          pendingLabel={t(`${E}.booking`)}
        />
      </SheetFooter>
    </form>
  )
}

type EditTab = 'appointment' | 'notes' | 'cancel' | 'history' | 'billing'

/** A personal appointment (AP-17): its professional takes it off her agenda (a cancellation, « Non spécifiée »). */
function PersonalCancel({ id, onDone }: { id: string; onDone: () => void }) {
  const cancel = useCancelAppointment()
  return (
    <Button
      type="button"
      variant="outline"
      aria-disabled={cancel.isPending || undefined}
      onClick={() => !cancel.isPending && cancel.mutate({ id, reasonKey: 'not_specified', details: null, keptOnSchedule: false }, { onSuccess: onDone })}
    >
      {t('modules.appointments.personal.cancel')}
    </Button>
  )
}

function EditPanel({
  appointment: a,
  move,
  reference,
  onClose,
}: {
  appointment: AgendaAppointment
  move?: { startsAt: string }
  reference: AgendaReference
  onClose: () => void
}) {
  const [tab, setTab] = useState<EditTab>('appointment')
  const confirmLeave = useConfirmLeave()
  const service = reference.services.find((s) => s.id === a.serviceId)
  const pro = reference.professionals.find((p) => p.id === a.professionalId)
  const open = a.state === 'booked' || a.state === 'confirmed'
  // « Facturation » (L10): only when a module fills the slot for this user (Facturation, billing.view).
  const billingPanels = useModuleSlot('appointment.sheet')
  const tabs: readonly EditTab[] = billingPanels.length > 0 ? ['appointment', 'notes', 'cancel', 'history', 'billing'] : ['appointment', 'notes', 'cancel', 'history']
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader>
        <SheetTitle>{appointmentTitle(a)}</SheetTitle>
        <SheetDescription>
          {formatClinicDateFull(a.startsAt)}, {formatClinicTime(a.startsAt)} – {formatClinicTime(a.endsAt)}
          {service && ` · ${service.name}`}
          {pro && ` · ${pro.name}`}
        </SheetDescription>
        <p className="flex flex-wrap gap-1.5">
          <Badge variant={stateBadgeVariant(a.state)}>{stateLabel(a.state)}</Badge>
          {a.keptOnSchedule && <Badge variant="secondary">{t(`${E}.keptOnSchedule`)}</Badge>}
          {a.cancelLate && <Badge variant="warning">{t(`${E}.lateCancel`)}</Badge>}
          {a.outsideAvailability && <Badge variant="warning">{t(`${E}.outsideBadge`)}</Badge>}
          {a.balanceOverride && <Badge variant="warning">{t(`${E}.balanceBadge`)}</Badge>}
          <Badge variant="outline">{modeLabel(a.mode)}</Badge>
        </p>
      </SheetHeader>
      {!a.isPersonal && (
        <NavTabs className="px-6">
          {tabs.map((key) => (
            <NavTab key={key} active={tab === key} onClick={() => key !== tab && confirmLeave(() => setTab(key))}>
              {t(`${E}.tabs.${key}`)}
            </NavTab>
          ))}
        </NavTabs>
      )}
      <SheetBody className="space-y-4">
        {tab === 'appointment' && !a.isPersonal && a.state !== 'cancelled' && a.state !== 'completed' && <AppointmentConsents appointment={a} />}
        {tab === 'appointment' && <AppointmentTab key={`${a.startsAt}|${a.serviceId ?? ''}`} appointment={a} move={move} reference={reference} open={open} />}
        {a.isPersonal && open && <PersonalCancel id={a.id} onDone={onClose} />}
        {tab === 'notes' && <NotesTab appointment={a} />}
        {tab === 'cancel' && <CancelTab appointment={a} reference={reference} open={open} onDone={onClose} />}
        {tab === 'history' && <AppointmentHistory appointment={a} reference={reference} />}
        {tab === 'billing' && !a.isPersonal && (
          <ModuleSlotTargetContext.Provider value={{ 'appointment.sheet': { appointmentId: a.id } }}>
            {billingPanels.map(({ id, component: Panel }) => (
              <RouteBoundary key={id} scope={`appointment.sheet:${id}`} compact>
                <Suspense fallback={<Loading />}>
                  <Panel />
                </Suspense>
              </RouteBoundary>
            ))}
          </ModuleSlotTargetContext.Provider>
        )}
      </SheetBody>
    </div>
  )
}

/** The consents this appointment still needs (AP-32), per client by name when there are two. */
function AppointmentConsents({ appointment: a }: { appointment: AgendaAppointment }) {
  const consents = useAppointmentConsents(a.id)
  return <ConsentsNotice consents={consents.data} failed={consents.isError} clientName={(id) => a.participants.find((p) => p.clientId === id)?.name ?? ''} />
}

/** « Changer le service » (AP-28): the same moment, the new service's duration; the client told once. */
function ServiceSection({ appointment: a, reference }: { appointment: AgendaAppointment; reference: AgendaReference }) {
  const { can } = useAccess()
  const offered = servicesFor(reference, a.professionalId).filter((s) => s.durationMinutes > 0)
  const [serviceId, setServiceId] = useState(a.serviceId ?? '')
  const [outside, setOutside] = useState(false)
  const [outsideReason, setOutsideReason] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const change = useChangeService({
    onErrorMessage: (msg, error) => {
      if (rpcErrorHint(error) === OUTSIDE && can('appointments.manage')) setOutside(true)
      setRefusal(msg)
    },
  })
  const chosen = reference.services.find((s) => s.id === serviceId)
  const changed = serviceId !== '' && serviceId !== a.serviceId
  useUnsavedChanges(changed)
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">{t(`${E}.serviceSection`)}</h3>
      <FormField
        label={t(`${E}.service`)}
        width="md"
        help={chosen ? t(`${E}.serviceHelp`, { duration: String(chosen.durationMinutes), buffer: String(chosen.bufferAfterMinutes) }) : undefined}
      >
        {(field) => (
          <Select {...field} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            {offered.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <OverrideFields outside={outside} balance={false} outsideReason={outsideReason} balanceReason="" setOutsideReason={setOutsideReason} setBalanceReason={() => undefined} />
      <Refusal message={refusal} />
      <Button
        type="button"
        variant="outline"
        aria-disabled={!changed || change.isPending || undefined}
        className={softDisabledClasses}
        onClick={() => {
          if (!changed || change.isPending) return
          setRefusal(null)
          change.mutate({ id: a.id, serviceId, outsideAvailabilityReason: outside ? outsideReason.trim() || null : null })
        }}
      >
        {t(change.isPending ? `${E}.changingService` : `${E}.changeService`)}
      </Button>
    </section>
  )
}

/** « Marquer confirmé » (AP-30, appointments.manage): after a call, a booked appointment becomes « Confirmé ». */
function MarkConfirmed({ appointment: a }: { appointment: AgendaAppointment }) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const confirm = useConfirmAppointment({ onErrorMessage: (msg) => setRefusal(msg) })
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={confirm.isPending || undefined}
          className={softDisabledClasses}
          onClick={() => {
            if (confirm.isPending) return
            setRefusal(null)
            confirm.mutate(a.id)
          }}
        >
          {t(`${E}.markConfirmed`)}
        </Button>
        <span className="text-xs text-muted-foreground">{t(`${E}.markConfirmedHelp`)}</span>
      </div>
      <Refusal message={refusal} />
    </section>
  )
}

function AppointmentTab({
  appointment: a,
  move: dragged,
  reference,
  open,
}: {
  appointment: AgendaAppointment
  move?: { startsAt: string }
  reference: AgendaReference
  open: boolean
}) {
  const { can } = useAccess()
  const detail = useAppointmentDetail(a.id)
  const [day, setDay] = useState(getClinicDateString(dragged?.startsAt ?? a.startsAt))
  const [time, setTime] = useState(getClinicTimeString(dragged?.startsAt ?? a.startsAt))
  const [professionalId, setProfessionalId] = useState(a.professionalId)
  const [outside, setOutside] = useState(Boolean(dragged) && can('appointments.manage'))
  const [outsideReason, setOutsideReason] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const move = useMoveAppointment({
    onErrorMessage: (msg, error) => {
      if (rpcErrorHint(error) === OUTSIDE && can('appointments.manage')) setOutside(true)
      setRefusal(msg)
    },
  })
  const presence = useSetPresence({ onErrorMessage: (msg) => setRefusal(msg) })
  const changed = day !== getClinicDateString(a.startsAt) || time !== getClinicTimeString(a.startsAt) || professionalId !== a.professionalId
  useUnsavedChanges(open && (changed || outsideReason.trim() !== ''))
  const eligible = a.serviceId ? reference.professionals.filter((p) => servicesFor(reference, p.id).some((s) => s.id === a.serviceId)) : reference.professionals

  return (
    <>
      {a.state === 'held' && <p className="rounded-md border border-dashed border-border bg-muted/40 p-3 text-sm">{t(`${E}.heldNotice`)}</p>}
      {a.mode === 'video' && !a.isPersonal && a.state !== 'cancelled' && a.state !== 'held' && <VideoSection appointmentId={a.id} />}
      {detail.data?.outsideAvailabilityReason && (
        <p className="text-sm">
          <span className="text-muted-foreground">{t(`${E}.outsideBadge`)} : </span>
          {detail.data.outsideAvailabilityReason}
        </p>
      )}
      {a.participants.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t(`${E}.presence`)}</h3>
          <ul className="space-y-1.5">
            {a.participants.map((p) => (
              <li key={p.clientId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium">{p.name}</span>
                  {p.role === 'second' && <span className="text-muted-foreground"> · {t(`${E}.secondPerson`)}</span>}
                  {p.confirmedAt && <span className="text-muted-foreground"> · {t(`${E}.confirmed`)}</span>}
                </span>
                <Select
                  aria-label={t(`${E}.presenceOf`, { name: p.name })}
                  value={p.presence}
                  disabled={a.state === 'cancelled' || a.state === 'held'}
                  onChange={(e) => presence.mutate({ appointmentId: a.id, clientId: p.clientId, presence: e.target.value as Presence })}
                  className="w-40"
                >
                  {PRESENCES.map((value) => (
                    <option key={value} value={value}>
                      {presenceLabel(value)}
                    </option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        </section>
      )}
      {a.state === 'booked' && !a.isPersonal && can('appointments.manage') && <MarkConfirmed appointment={a} />}
      {open && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t(`${E}.move`)}</h3>
          <FormRow>
            <FormField label={t(`${E}.date`)} width="sm">
              {(field) => <DateField {...field} value={day} onChange={setDay} />}
            </FormField>
            <FormField label={t(`${E}.time`)} width="sm">
              {(field) => <TimeField {...field} value={time} onChange={setTime} />}
            </FormField>
            {!a.isPersonal && (
              <FormField label={t(`${E}.professional`)} width="md">
                {(field) => (
                  <Select {...field} value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
                    {eligible.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            )}
          </FormRow>
          <OverrideFields outside={outside} balance={false} outsideReason={outsideReason} balanceReason="" setOutsideReason={setOutsideReason} setBalanceReason={() => undefined} />
          <Refusal message={refusal} />
          <Button
            type="button"
            variant="outline"
            disabled={!changed || move.isPending}
            onClick={() => {
              setRefusal(null)
              move.mutate({
                id: a.id,
                startsAt: clinicTimeToUTC(day, time),
                professionalId: professionalId === a.professionalId ? null : professionalId,
                outsideAvailabilityReason: outside ? outsideReason.trim() || null : null,
              })
            }}
          >
            {t(move.isPending ? `${E}.moving` : `${E}.moveSubmit`)}
          </Button>
        </section>
      )}
      {open && !a.isPersonal && a.serviceId && <ServiceSection appointment={a} reference={reference} />}
    </>
  )
}

function NotesTab({ appointment: a }: { appointment: AgendaAppointment }) {
  const detail = useAppointmentDetail(a.id)
  if (!detail.data) return <Loading />
  return <NotesForm key={`${detail.data.internalNote}|${detail.data.clientMessage}|${a.mode}`} appointment={a} note={detail.data.internalNote ?? ''} message={detail.data.clientMessage ?? ''} />
}

function NotesForm({ appointment: a, note: storedNote, message: storedMessage }: { appointment: AgendaAppointment; note: string; message: string }) {
  const [mode, setMode] = useState<AppointmentMode>(a.mode)
  const [note, setNote] = useState(storedNote)
  const [message, setMessage] = useState(storedMessage)
  const [refusal, setRefusal] = useState<string | null>(null)
  const save = useSetAppointmentDetails({ onErrorMessage: (msg) => setRefusal(msg) })
  const dirty = mode !== a.mode || note !== storedNote || message !== storedMessage
  useUnsavedChanges(dirty)
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        setRefusal(null)
        save.mutate({ id: a.id, mode, internalNote: note.trim() || null, clientMessage: message.trim() || null })
      }}
    >
      <FormField label={t(`${E}.mode`)} width="sm">
        {(field) => (
          <Select {...field} value={mode} onChange={(e) => setMode(e.target.value as AppointmentMode)}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {modeLabel(m)}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label={t(`${E}.internalNote`)} width="full" help={t(`${E}.internalNoteHelp`)}>
        {(field) => <Textarea {...field} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={5000} />}
      </FormField>
      <FormField label={t(`${E}.clientMessage`)} width="full" help={t(`${E}.clientMessageHelp`)}>
        {(field) => <Textarea {...field} value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000} />}
      </FormField>
      <Refusal message={refusal} />
      <SaveButton pending={save.isPending} disabled={!dirty} />
    </form>
  )
}

function CancelTab({ appointment: a, reference, open, onDone }: { appointment: AgendaAppointment; reference: AgendaReference; open: boolean; onDone: () => void }) {
  const detail = useAppointmentDetail(a.id)
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [kept, setKept] = useState(false)
  const [rest, setRest] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const cancel = useCancelAppointment({ onErrorMessage: (msg) => setRefusal(msg) })
  const cancelRest = useCancelSeriesFrom({ onErrorMessage: (msg) => setRefusal(msg) })
  const cancelling = cancel.isPending || cancelRest.isPending
  const reasons = reference.reasons.filter((r) => r.active)
  useUnsavedChanges(open && (reason !== '' || details.trim() !== ''))
  if (!open) {
    const name = reference.reasons.find((r) => r.id === a.cancelReasonId)?.name
    return (
      <div className="space-y-3 text-sm">
        <div className="space-y-1">
          <p>
            {a.state === 'cancelled'
              ? t(`${E}.cancelledWith`, { reason: name ?? t(`${E}.noReason`) })
              : a.state === 'held'
                ? t(`${E}.heldNotice`)
                : t(`${E}.notCancellable`)}
          </p>
          {detail.data?.cancelDetails && <p className="text-muted-foreground">{detail.data.cancelDetails}</p>}
        </div>
        {a.state === 'cancelled' && <RestoreSection appointment={a} />}
      </div>
    )
  }
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!reason || cancelling) return
        setRefusal(null)
        const input = { id: a.id, reasonKey: reason, details: details.trim() || null, keptOnSchedule: kept }
        if (rest) cancelRest.mutate(input, { onSuccess: onDone })
        else cancel.mutate(input, { onSuccess: onDone })
      }}
    >
      <FormField label={t(`${E}.reason`)} width="md" required>
        {(field) => (
          <Select {...field} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t(`${E}.choose`)}>
            {reasons.map((r) => (
              <option key={r.id} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField label={t(`${E}.details`)} width="full">
        {(field) => <Textarea {...field} value={details} onChange={(e) => setDetails(e.target.value)} rows={2} maxLength={1000} />}
      </FormField>
      <CheckboxField label={t(`${E}.keep`)} help={t(`${E}.keepHelp`)} checked={kept} onCheckedChange={(v) => setKept(v === true)} />
      {a.seriesId && <CheckboxField label={t(`${E}.series.cancelRest`)} help={t(`${E}.series.cancelRestHelp`)} checked={rest} onCheckedChange={setRest} />}
      <Refusal message={refusal} />
      <Button
        type="submit"
        variant="destructive"
        aria-disabled={!reason || cancelling || undefined}
        className={cn(softDisabledClasses, 'aria-disabled:hover:bg-destructive')}
      >
        {t(cancelling ? `${E}.cancelling` : `${E}.cancelSubmit`)}
      </Button>
    </form>
  )
}

/** « Rétablir » (AP-29): a cancelled appointment still to come is booked again if its slot is free. */
function RestoreSection({ appointment: a }: { appointment: AgendaAppointment }) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const restore = useRestoreAppointment({ onErrorMessage: (msg) => setRefusal(msg) })
  // The clinic's « now » is the browser's instant; the database refuses a past one anyway.
  const past = new Date(a.startsAt).getTime() <= Date.now()
  if (past) return <p className="text-muted-foreground">{t(`${E}.restorePast`)}</p>
  return (
    <section className="space-y-2">
      <p className="text-muted-foreground">{t(`${E}.restoreHelp`)}</p>
      <Refusal message={refusal} />
      <Button
        type="button"
        variant="outline"
        aria-disabled={restore.isPending || undefined}
        className={softDisabledClasses}
        onClick={() => {
          if (restore.isPending) return
          setRefusal(null)
          restore.mutate(a.id)
        }}
      >
        {t(restore.isPending ? `${E}.restoring` : `${E}.restore`)}
      </Button>
    </section>
  )
}

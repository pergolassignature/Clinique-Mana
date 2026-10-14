import { Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellOff, ChevronLeft, ChevronRight, Plus, Printer } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { rpcErrorCode, rpcErrorHint } from '@/core/modules/errors'
import { useModuleSlot } from '@/core/modules/slots'
import { EmptyState } from '@/shared/components/EmptyState'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { RouteBoundary } from '@/shared/components/RouteBoundary'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import { formatDateOnly, getClinicDateString } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { useUrlParams } from '@/shared/lib/use-url-params'
import { PHONE_QUERY, useMediaQuery } from '@/shared/lib/use-media-query'
import { Button } from '@/shared/ui/button'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import type { AgendaReference } from '../api/agenda'
import type { AgendaAppointment } from '../api/parse'
import { AppointmentSheet, type SheetTarget } from '../components/AppointmentSheet'
import { ExceptionsPanel, RuleDialog, type RuleTarget } from '../components/AvailabilityEditors'
import { AvailabilityGrid, type AvailabilityTool } from '../components/AvailabilityGrid'
import { MonthView } from '../components/MonthView'
import { PersonalDialog } from '../components/PersonalDialog'
import { TimeGrid, type GridColumn } from '../components/TimeGrid'
import { UpcomingList } from '../components/UpcomingList'
import { WithoutReminderSheet } from '../components/WithoutReminderSheet'
import { useAgenda, useAgendaReference, useAvailability, useMoveAppointment, useMyAgendaReference } from '../hooks/use-agenda'
import { useAvailabilityEditing } from '../hooks/use-availability-edit'
import { useExternalBusy } from '../hooks/use-calendar'
import { APPOINTMENT_LINK_PARAM as LINK_PARAM, servicesFor, weekdayLabel } from '../lib/display'
import { addDays, daysFrom, hhmm, isoWeekday, monthGrid, rangeOf, startOfWeek } from '../lib/time'

const A = 'modules.appointments.agenda'
const VIEWS = ['jour', 'semaine', 'jours', 'mois'] as const
type View = (typeof VIEWS)[number]
type Mode = 'rendez-vous' | 'disponibilites'
type SheetState = Extract<SheetTarget, { kind: 'create' }> | { kind: 'edit'; id: string; move?: { startsAt: string } }
const UPCOMING_DAYS = 14
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * « Agenda » (plan R2): the clinic's appointments in four views (Jour, Semaine, Prochains jours,
 * Mois: real Radix tabs, decision #35), for all professionals, a service's or one; the view, the
 * date, the professional, the service and the mode live in the URL (a link opens the same
 * agenda; `rendez-vous=<id>` with its date opens that appointment, AP-33). « Rendez-vous »: click a free quarter hour to book there, drag an appointment to move
 * it, open one to edit, mark presence or cancel. « Disponibilités » (one professional): her weekly
 * windows to edit and her exceptions. Every rule is the database's (R1, AP-12).
 */
export function AgendaPage() {
  usePageTitle(t(`${A}.title`))
  const reference = useAgendaReference()
  if (reference.isError) return <LoadError message={t(`${A}.loadError`)} onRetry={() => void reference.refetch()} retrying={reference.isFetching} />
  if (!reference.data) return <Loading />
  return <Agenda reference={reference.data} />
}

/**
 * « Mon agenda » (plan R5, AP-23): the professional's own agenda, the same views on her alone. She
 * moves and cancels her appointments, notes presence, edits her availability and adds personal
 * appointments (a click on a free quarter hour); booking clients is the clinic's (dispatch).
 */
export function MyAgendaPage() {
  usePageTitle(t('modules.appointments.mine.title'))
  const reference = useMyAgendaReference()
  if (reference.isError) {
    if (rpcErrorCode(reference.error) === '42501') {
      return <FullPageMessage role="status" title={t('modules.appointments.mine.notProfessionalTitle')} body={t('modules.appointments.mine.notProfessionalBody')} />
    }
    return <LoadError message={t('modules.appointments.mine.loadError')} onRetry={() => void reference.refetch()} retrying={reference.isFetching} />
  }
  if (!reference.data) return <Loading />
  return (
    <>
      <Agenda reference={reference.data} mine />
      <MineSlots />
    </>
  )
}

/** The panels other modules add to « Mon agenda » (slot `agenda.mine`; Facturation's fees to decide). */
function MineSlots() {
  const panels = useModuleSlot('agenda.mine')
  if (panels.length === 0) return null
  return (
    <div className="mt-6 space-y-6">
      {panels.map(({ id, component: Panel }) => (
        <RouteBoundary key={id} scope={`agenda.mine:${id}`} compact>
          <Suspense fallback={<Loading />}>
            <Panel />
          </Suspense>
        </RouteBoundary>
      ))}
    </div>
  )
}

function Agenda({ reference, mine = false }: { reference: AgendaReference; mine?: boolean }) {
  const { can } = useAccess()
  const canWrite = can(mine ? 'appointments.self' : 'appointments.manage')
  const [personal, setPersonal] = useState<{ day: string; time: string } | null>(null)
  const { params, update } = useUrlParams()
  // « Clients sans rappel » opens with `?sans-rappel=1` (Accueil's card, L29).
  const [unreachable, setUnreachable] = useState(() => params.get('sans-rappel') === '1')
  const today = getClinicDateString(new Date())
  // On a phone a week of seven columns does not fit: the day is the default there (the address
  // keeps any view chosen).
  const phone = useMediaQuery(PHONE_QUERY)
  const defaultView: View = phone ? 'jour' : 'semaine'
  const view: View = (VIEWS as readonly string[]).includes(params.get('vue') ?? '') ? (params.get('vue') as View) : defaultView
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : today
  const proParam = params.get('professionnel')
  const pro = mine ? (reference.professionals[0]?.id ?? null) : reference.professionals.some((p) => p.id === proParam) ? proParam : null
  const service = mine ? null : (reference.services.find((s) => s.id === params.get('service')) ?? null)
  const mode: Mode = params.get('mode') === 'disponibilites' ? 'disponibilites' : 'rendez-vous'
  // The editor holds an id: it always shows the agenda's current row (never a stale snapshot).
  // `rendez-vous=<id>` (with its date) opens one from a link (Clients' « Visites et paiements »).
  const linked = params.get(LINK_PARAM)
  const [sheet, setSheet] = useState<SheetState | null>(() => (linked && UUID.test(linked) ? { kind: 'edit', id: linked } : null))
  const [rule, setRule] = useState<RuleTarget | null>(null)
  const [tool, setTool] = useState<AvailabilityTool>('available')


  // Who is shown: one professional, a service's, or all.
  const shown = useMemo(() => {
    if (pro) return reference.professionals.filter((p) => p.id === pro)
    if (service) return reference.professionals.filter((p) => servicesFor(reference, p.id).some((s) => s.id === service.id))
    return reference.professionals
  }, [reference, pro, service])
  const shownIds = pro || service ? shown.map((p) => p.id) : null
  const professionalName = (id: string) => reference.professionals.find((p) => p.id === id)?.name ?? ''

  const effectiveView: View = mode === 'disponibilites' ? 'semaine' : view
  const first = effectiveView === 'jour' ? day : effectiveView === 'semaine' ? startOfWeek(day) : effectiveView === 'jours' ? day : monthGrid(day)[0]!
  const length = effectiveView === 'jour' ? 1 : effectiveView === 'semaine' ? 7 : effectiveView === 'jours' ? UPCOMING_DAYS : 42
  const range = rangeOf(first, length)
  const availabilityEditing = useAvailabilityEditing(pro, first)
  const agenda = useAgenda(range.from, range.to, shownIds, mode === 'rendez-vous')
  const availabilityIds = mode === 'disponibilites' ? (pro ? [pro] : []) : effectiveView === 'jour' ? shown.map((p) => p.id) : pro ? [pro] : []
  const availability = useAvailability(availabilityIds, range.from)
  // Google busy times (R6): drawn where a column has one professional (the day, or a week of one).
  const timeGrid = mode === 'rendez-vous' && (effectiveView === 'jour' || effectiveView === 'semaine')
  const busyIds = effectiveView === 'jour' ? shown.map((p) => p.id) : pro ? [pro] : []
  const externalBusy = useExternalBusy(range.from, range.to, busyIds, timeGrid && busyIds.length > 0)
  // A personal appointment taken off is gone from the agenda (a clients' cancellation stays, struck).
  const appointments = useMemo(() => (agenda.data ?? []).filter((a) => !(a.isPersonal && a.state === 'cancelled')), [agenda.data])

  // A drag outside the availability: the staff get the editor with the dragged time and
  // « Hors disponibilités » (AP-12); any other refusal is a toast.
  const [dragged, setDragged] = useState<{ id: string; startsAt: string } | null>(null)
  const move = useMoveAppointment({
    onErrorMessage: (message, error) => {
      if (rpcErrorHint(error) === 'outside_availability' && canWrite && dragged) setSheet({ kind: 'edit', id: dragged.id, move: { startsAt: dragged.startsAt } })
      else toast.error(message)
    },
  })
  const onMove = (a: AgendaAppointment, startsAt: string) => {
    setDragged({ id: a.id, startsAt })
    move.mutate({ id: a.id, startsAt, professionalId: null, outsideAvailabilityReason: null })
  }
  const editing = sheet?.kind === 'edit' ? appointments.find((a) => a.id === sheet.id) : undefined
  const sheetTarget: SheetTarget | null =
    sheet === null ? null : sheet.kind === 'create' ? sheet : editing ? { kind: 'edit', appointment: editing, move: sheet.move } : null

  const step = effectiveView === 'jour' ? 1 : effectiveView === 'mois' ? 0 : 7
  const go = (direction: -1 | 1) => {
    if (effectiveView === 'mois') {
      const [y, m] = day.split('-').map(Number)
      const target = new Date(Date.UTC(y!, m! - 1 + direction, 1)).toISOString().slice(0, 10)
      update({ date: target })
    } else update({ date: addDays(day, direction * step) })
  }
  const title =
    effectiveView === 'jour'
      ? formatDateOnly(day, 'EEEE d MMMM yyyy')
      : effectiveView === 'semaine'
        ? t(`${A}.weekOf`, { date: formatDateOnly(first, 'd MMMM yyyy') })
        : effectiveView === 'jours'
          ? t(`${A}.from`, { date: formatDateOnly(day, 'd MMMM yyyy') })
          : formatDateOnly(day, 'MMMM yyyy')

  const columns: GridColumn[] =
    effectiveView === 'jour'
      ? shown.map((p) => ({ key: p.id, day, professionalId: p.id, label: p.name }))
      : daysFrom(first, 7).map((d) => ({
          key: d,
          day: d,
          professionalId: pro,
          label: `${weekdayLabel(isoWeekday(d))} ${Number(d.slice(8))}`,
          sublabel: d === today ? t(`${A}.today`) : undefined,
        }))

  const onCreate = (d: string, minutes: number, professionalId: string | null) => {
    if (mine) setPersonal({ day: d, time: hhmm(minutes) })
    else setSheet({ kind: 'create', professionalId: professionalId ?? pro, day: d, time: hhmm(minutes) })
  }

  return (
    <>
      <PageHeader
        level={1}
        title={mine ? t('modules.appointments.mine.title') : t(`${A}.title`)}
        description={mine ? t('modules.appointments.mine.description') : t(`${A}.description`)}
        actions={
          mode === 'disponibilites' ? (
            canWrite && pro ? (
              <Button
                type="button"
                onClick={() => setRule({ professionalId: pro, weekday: first <= today && today <= addDays(first, 6) ? isoWeekday(today) : 1, startTime: '09:00' })}
              >
                <Plus aria-hidden />
                {t('modules.appointments.availability.addWindow')}
              </Button>
            ) : undefined
          ) : mine ? (
            canWrite && mode === 'rendez-vous' ? (
              <Button type="button" onClick={() => setPersonal({ day, time: '12:00' })}>
                <Plus aria-hidden />
                {t('modules.appointments.personal.new')}
              </Button>
            ) : undefined
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setUnreachable(true)}>
                <BellOff aria-hidden />
                {t('modules.appointments.withoutReminder.title')}
              </Button>
              {canWrite && mode === 'rendez-vous' && (
                <Button type="button" onClick={() => setSheet({ kind: 'create', professionalId: pro, day, time: '09:00' })}>
                  <Plus aria-hidden />
                  {t(`${A}.new`)}
                </Button>
              )}
            </>
          )
        }
      />
      {unreachable && (
        <WithoutReminderSheet
          professionalName={(id) => reference.professionals.find((p) => p.id === id)?.name ?? ''}
          onClose={() => {
            setUnreachable(false)
            if (params.has('sans-rappel')) update({ 'sans-rappel': null })
          }}
        />
      )}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Tabs value={effectiveView} onValueChange={(v) => update({ vue: v === defaultView ? null : v, mode: null })}>
          <TabsList aria-label={t(`${A}.views`)}>
            {VIEWS.map((v) => (
              <TabsTrigger key={v} value={v}>
                {t(`${A}.view.${v}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" onClick={() => update({ date: null })}>
            {t(`${A}.todayButton`)}
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={t(`${A}.previous`)} onClick={() => go(-1)}>
            <ChevronLeft aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={t(`${A}.next`)} onClick={() => go(1)}>
            <ChevronRight aria-hidden />
          </Button>
          <h2 className="ml-1 text-sm font-medium first-letter:uppercase" aria-live="polite">
            {title}
          </h2>
          {mode === 'rendez-vous' && (effectiveView === 'jour' || effectiveView === 'semaine') && (
            <Button asChild variant="ghost" size="sm">
              <Link to={`${mine ? '/mon-agenda' : '/agenda'}/imprimer?${params.toString()}`}>
                <Printer aria-hidden />
                {t('modules.appointments.print.open')}
              </Link>
            </Button>
          )}
        </div>
        {!mine && (
          <>
            <div className="w-field-md max-w-full">
              <Select aria-label={t(`${A}.professional`)} value={pro ?? ''} onChange={(e) => update({ professionnel: e.target.value })} placeholder={t(`${A}.allProfessionals`)} clearable>
                {reference.professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-field-md max-w-full">
              <Select aria-label={t(`${A}.service`)} value={service?.id ?? ''} onChange={(e) => update({ service: e.target.value })} placeholder={t(`${A}.allServices`)} clearable>
                {reference.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </>
        )}
        <SegmentedToggle
          label={t(`${A}.modeLabel`)}
          value={mode}
          onChange={(m) => update({ mode: m === 'rendez-vous' ? null : m })}
          options={[
            { value: 'rendez-vous', label: t(`${A}.mode.booking`) },
            { value: 'disponibilites', label: t(`${A}.mode.availability`) },
          ]}
        />
      </div>

      {mode === 'disponibilites' && !pro ? (
        <EmptyState title={t(`${A}.choosePro`)} body={t(`${A}.chooseProBody`)} />
      ) : agenda.isError && !agenda.data && mode === 'rendez-vous' ? (
        <LoadError message={t(`${A}.loadError`)} onRetry={() => void agenda.refetch()} retrying={agenda.isFetching} />
      ) : effectiveView === 'mois' ? (
        <MonthView day={day} today={today} appointments={appointments} onDay={(d) => update({ vue: 'jour', date: d })} />
      ) : effectiveView === 'jours' ? (
        <UpcomingList appointments={appointments} services={reference.services} professionalName={professionalName} onOpen={(a) => setSheet({ kind: 'edit', id: a.id })} />
      ) : (
        <div className="space-y-4">
          {mode === 'disponibilites' && pro ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <SegmentedToggle
                  label={t('modules.appointments.availability.tool')}
                  value={tool}
                  onChange={setTool}
                  options={[
                    { value: 'available', label: t('modules.appointments.availability.toolAvailable') },
                    { value: 'block', label: t('modules.appointments.availability.toolBlock') },
                  ]}
                />
                <p className="min-w-0 basis-full text-xs text-muted-foreground sm:basis-0 sm:flex-1">
                  {t(tool === 'block' ? 'modules.appointments.availability.gridHelpBlock' : 'modules.appointments.availability.gridHelp')}
                </p>
              </div>
              <AvailabilityGrid
                columns={columns}
                professionalId={pro}
                rules={availability.data?.rules ?? []}
                exceptions={availability.data?.exceptions ?? []}
                canWrite={canWrite}
                tool={tool}
                onCreate={availabilityEditing.create}
                onChange={availabilityEditing.change}
                onBlock={availabilityEditing.block}
                onWeekly={availabilityEditing.setWeekly}
                onDelete={availabilityEditing.remove}
                onMore={(r) => setRule({ rule: r })}
                onUnblock={availabilityEditing.unblock}
              />
            </>
          ) : columns.length === 0 ? (
            <EmptyState title={t(`${A}.noProfessional`)} />
          ) : (
            <TimeGrid
              columns={columns}
              appointments={appointments}
              rules={availability.data?.rules ?? []}
              exceptions={availability.data?.exceptions ?? []}
              shadeProfessionalId={pro}
              professionalName={professionalName}
              showProfessional={effectiveView === 'semaine' && !pro}
              canWrite={canWrite}
              onCreate={onCreate}
              onOpen={(a) => setSheet({ kind: 'edit', id: a.id })}
              onMove={onMove}
              serviceColour={(id) => reference.services.find((s) => s.id === id)?.colour ?? null}
              busy={externalBusy.data ?? []}
            />
          )}
          {mode === 'disponibilites' && pro && (
            <ExceptionsPanel
              professionalId={pro}
              weekStart={first}
              exceptions={availability.data?.exceptions ?? []}
              mine={mine}
              onVacationWeek={availabilityEditing.vacationWeek}
              busy={availabilityEditing.busy}
            />
          )}
        </div>
      )}

      {sheetTarget && (
        <AppointmentSheet
          target={sheetTarget}
          reference={reference}
          onClose={() => {
            setSheet(null)
            if (linked) update({ [LINK_PARAM]: null })
          }}
        />
      )}
      {rule && <RuleDialog target={rule} reference={reference} onClose={() => setRule(null)} />}
      {personal && <PersonalDialog day={personal.day} time={personal.time} onClose={() => setPersonal(null)} />}
    </>
  )
}

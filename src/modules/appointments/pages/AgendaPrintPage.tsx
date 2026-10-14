import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { t } from '@/i18n'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { formatClinicDateTime, formatClinicTime, formatDateOnly, getClinicDateString } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Button } from '@/shared/ui/button'
import type { AgendaReference } from '../api/agenda'
import type { AgendaAppointment } from '../api/parse'
import { useAgenda, useAgendaReference, useMyAgendaReference } from '../hooks/use-agenda'
import { appointmentTitle, modeLabel, servicesFor, stateLabel } from '../lib/display'
import { daysFrom, rangeOf, startOfWeek } from '../lib/time'

const P = 'modules.appointments.print'

/** What a printed day lists: every appointment holding its slot (a cancellation only when kept on the schedule). */
const printed = (a: AgendaAppointment) => a.state !== 'cancelled' || a.keptOnSchedule

/**
 * « Imprimer l'agenda » (AP-48, parity audit L14): the agenda's day or week as a plain list to
 * print, from the agenda's own address (`vue`, `date`, `professionnel`, `service`). Per day, per
 * professional: the time, the client(s), the service, the mode and the state; never a note, a
 * message or a contact. The shell and the buttons never print (`data-print="hide"`).
 */
export function AgendaPrintPage() {
  const reference = useAgendaReference()
  return <PrintFrame reference={reference} backTo="/agenda" />
}

/** « Mon agenda » printed: the professional's own day or week. */
export function MyAgendaPrintPage() {
  const reference = useMyAgendaReference()
  return <PrintFrame reference={reference} backTo="/mon-agenda" mine />
}

interface FrameProps {
  reference: ReturnType<typeof useAgendaReference>
  backTo: string
  mine?: boolean
}

function PrintFrame({ reference, backTo, mine = false }: FrameProps) {
  usePageTitle(t(`${P}.title`))
  if (reference.isError) return <LoadError message={t(`${P}.loadError`)} onRetry={() => void reference.refetch()} retrying={reference.isFetching} />
  if (!reference.data) return <Loading />
  return <PrintedAgenda reference={reference.data} backTo={backTo} mine={mine} />
}

function PrintedAgenda({ reference, backTo, mine }: { reference: AgendaReference; backTo: string; mine: boolean }) {
  const [params] = useSearchParams()
  const today = getClinicDateString(new Date())
  const week = params.get('vue') !== 'jour'
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : today
  const proParam = params.get('professionnel')
  const pro = mine ? (reference.professionals[0]?.id ?? null) : reference.professionals.some((p) => p.id === proParam) ? proParam : null
  const service = mine ? null : (reference.services.find((s) => s.id === params.get('service')) ?? null)
  const shown = useMemo(() => {
    if (pro) return reference.professionals.filter((p) => p.id === pro)
    if (service) return reference.professionals.filter((p) => servicesFor(reference, p.id).some((s) => s.id === service.id))
    return reference.professionals
  }, [reference, pro, service])
  const first = week ? startOfWeek(day) : day
  const days = daysFrom(first, week ? 7 : 1)
  const range = rangeOf(first, days.length)
  const agenda = useAgenda(range.from, range.to, pro || service ? shown.map((p) => p.id) : null)
  const serviceName = (id: string | null) => reference.services.find((s) => s.id === id)?.name ?? ''
  const back = `${backTo}?${params.toString()}`

  const heading = week ? t(`${P}.week`, { date: formatDateOnly(first, 'd MMMM yyyy') }) : formatDateOnly(day, 'EEEE d MMMM yyyy')
  const who = mine ? '' : pro ? (shown[0]?.name ?? '') : service ? service.name : t(`${P}.everyone`)

  return (
    <article className="space-y-5" aria-label={t(`${P}.title`)}>
      <div data-print="hide" className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline">
          <Link to={back}>
            <ArrowLeft aria-hidden />
            {t(`${P}.back`)}
          </Link>
        </Button>
        <Button type="button" onClick={() => window.print()}>
          <Printer aria-hidden />
          {t(`${P}.print`)}
        </Button>
      </div>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold first-letter:uppercase">{heading}</h1>
        {who && <p className="text-sm text-muted-foreground">{who}</p>}
        <p className="text-xs text-muted-foreground">{t(`${P}.printedAt`, { when: formatClinicDateTime(new Date()) })}</p>
      </header>
      {agenda.isError && !agenda.data ? (
        <LoadError message={t(`${P}.loadError`)} onRetry={() => void agenda.refetch()} retrying={agenda.isFetching} />
      ) : !agenda.data ? (
        <Loading />
      ) : (
        days.map((d) => {
          const ofDay = agenda.data.filter((a) => printed(a) && getClinicDateString(a.startsAt) === d)
          return (
            <section key={d} aria-label={formatDateOnly(d, 'EEEE d MMMM')} className="space-y-3 break-inside-avoid-page">
              {week && <h2 className="border-b border-border pb-1 text-base font-semibold first-letter:uppercase">{formatDateOnly(d, 'EEEE d MMMM')}</h2>}
              {ofDay.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t(`${P}.none`)}</p>
              ) : (
                shown
                  .filter((p) => ofDay.some((a) => a.professionalId === p.id))
                  .map((p) => (
                    <div key={p.id} className="space-y-1">
                      {shown.length > 1 && <h3 className="text-sm font-semibold">{p.name}</h3>}
                      <table className="w-full table-fixed border-collapse text-sm">
                        <thead className="sr-only">
                          <tr>
                            <th>{t(`${P}.columns.time`)}</th>
                            <th>{t(`${P}.columns.client`)}</th>
                            <th>{t(`${P}.columns.service`)}</th>
                            <th>{t(`${P}.columns.state`)}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ofDay
                            .filter((a) => a.professionalId === p.id)
                            .sort((x, y) => x.startsAt.localeCompare(y.startsAt))
                            .map((a) => (
                              <tr key={a.id} className="border-b border-border align-top">
                                <td className="tabular w-32 whitespace-nowrap py-1 pr-3">
                                  {formatClinicTime(a.startsAt)} – {formatClinicTime(a.endsAt)}
                                </td>
                                <td className="w-[38%] py-1 pr-3 font-medium">{a.isPersonal ? t(`${P}.personal`, { label: appointmentTitle(a) }) : appointmentTitle(a)}</td>
                                <td className="w-[38%] py-1 pr-3">{a.isPersonal ? '' : `${serviceName(a.serviceId)} · ${modeLabel(a.mode)}`}</td>
                                <td className="whitespace-nowrap py-1">
                                  {a.state === 'cancelled' ? t(`${P}.keptCancelled`) : a.isPersonal ? '' : stateLabel(a.state)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ))
              )}
            </section>
          )
        })
      )}
    </article>
  )
}

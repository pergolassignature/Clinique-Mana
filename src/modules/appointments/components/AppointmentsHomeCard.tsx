import { t } from '@/i18n'
import { HomeQueueCard } from '@/shared/components/HomeQueueCard'
import { clinicTimeToUTC, shiftCalendarDay } from '@/shared/lib/timezone'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { useAgenda, useWithoutReminder } from '../hooks/use-agenda'

const H = 'modules.appointments.home'

/**
 * Accueil « Rendez-vous à surveiller » (L29, appointments.view): today's appointments still
 * « Réservé » (not confirmed yet, still to come) → the day's agenda; the next 7 days' appointments
 * no recipient of which can be reached (« Clients sans rappel ») → the agenda with that list open.
 * Only what is not zero; nothing when all is well or a read fails (the agenda still says it). The
 * module's own queries (`list_agenda` for today, the without-reminder list the agenda opens), read
 * once, never polled.
 */
export function AppointmentsHomeCard() {
  const today = useClinicDate()
  const agenda = useAgenda(clinicTimeToUTC(today, '00:00'), clinicTimeToUTC(shiftCalendarDay(today, 1), '00:00'), null)
  const withoutReminder = useWithoutReminder()
  if (!agenda.data && !withoutReminder.data) return null
  const now = Date.now()
  const unconfirmed = (agenda.data ?? []).filter((a) => !a.isPersonal && a.state === 'booked' && Date.parse(a.startsAt) >= now).length
  return (
    <HomeQueueCard
      title={t(`${H}.title`)}
      items={[
        { key: 'unconfirmed', count: unconfirmed, label: t(`${H}.items.unconfirmed`), to: `/agenda?vue=jour&date=${today}` },
        { key: 'without_reminder', count: withoutReminder.data?.length ?? 0, label: t(`${H}.items.withoutReminder`), to: '/agenda?sans-rappel=1' },
      ]}
    />
  )
}

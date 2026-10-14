import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { t } from '@/i18n'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { toast } from '@/shared/ui/sonner'
import { calendarErrorMessage } from '../api/calendar-errors'
import { GoogleCalendarCard } from '../components/calendar/GoogleCalendarCard'
import { useFinishCalendarConnect, useMyCalendarSetup } from '../hooks/use-calendar'
import { CALENDAR_RETURN_PATH } from '../lib/calendar'

const C = 'modules.appointments.calendar'

/**
 * « Agenda Google » (`/mon-agenda/agenda-google`, `appointments.self`, R6): the professional's
 * opt-in Google busy times. It is also where Google sends the browser back with `?code=&state=`
 * (or `?error=` when she declined): the page posts both to `google-calendar-callback` once with her
 * own session, then empties the address, so the code never stays in the history.
 */
export function MyGoogleCalendarPage() {
  usePageTitle(t(`${C}.page.title`))
  const [params] = useSearchParams()
  const navigate = useNavigate()
  // Read once: the address is then emptied (below).
  const [{ declined, code, state }] = useState(() => {
    const refused = params.get('error') !== null
    return { declined: refused, code: refused ? null : params.get('code'), state: refused ? null : params.get('state') }
  })
  const finish = useFinishCalendarConnect(code, state)
  const announced = useRef(false)
  const setup = useMyCalendarSetup()

  useEffect(() => {
    if (params.size > 0) navigate(CALENDAR_RETURN_PATH, { replace: true })
  }, [params, navigate])

  useEffect(() => {
    if (!finish.data || announced.current) return
    announced.current = true
    toast.success(finish.data.email ? t(`${C}.connectedToast`, { email: finish.data.email }) : t(`${C}.connectedToastPlain`))
  }, [finish.data])

  let body
  if (setup.isPending || finish.isFetching) {
    body = <Loading />
  } else if (setup.isError && !setup.data) {
    body = <LoadError message={t(`${C}.page.loadError`)} retrying={setup.isFetching} onRetry={() => void setup.refetch()} />
  } else if (!setup.data) {
    return <FullPageMessage role="status" title={t(`${C}.page.notProfessionalTitle`)} body={t(`${C}.page.notProfessionalBody`)} />
  } else {
    body = <GoogleCalendarCard setup={setup.data} />
  }
  return (
    <div className="max-w-form space-y-5">
      <PageHeader level={1} title={t(`${C}.page.title`)} description={t(`${C}.page.description`)} />
      {declined && <RefusalAlert message={t(`${C}.declined`)} />}
      {finish.isError && <RefusalAlert message={calendarErrorMessage(finish.error)} />}
      {body}
    </div>
  )
}

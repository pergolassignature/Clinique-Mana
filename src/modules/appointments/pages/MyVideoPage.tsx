import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { t } from '@/i18n'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { toast } from '@/shared/ui/sonner'
import { videoErrorMessage } from '../api/video-errors'
import { FixedLinkForm } from '../components/video/FixedLinkForm'
import { ZoomConnectionCard } from '../components/video/ZoomConnectionCard'
import { useFinishZoomConnect, useMyVideoSetup } from '../hooks/use-video'
import { ZOOM_RETURN_PATH } from '../lib/video'

const V = 'modules.appointments.video'

/**
 * « Vidéoconférence » (`/mon-agenda/videoconference`, `appointments.self`): how the professional's
 * video appointments get their link (R-55): her Zoom (connected here) or her fixed link (Meet,
 * Teams…). It is also where Zoom sends the browser back with `?code=&state=` (or `?error=` when she
 * declined): the page posts both to `zoom-callback` once with her own session, then empties the
 * address, so the code never stays in the history. « Mon agenda » (R5) will hold these cards.
 */
export function MyVideoPage() {
  usePageTitle(t(`${V}.page.title`))
  const [params] = useSearchParams()
  const navigate = useNavigate()
  // Read once: the address is then emptied (below).
  const [{ declined, code, state }] = useState(() => {
    const refused = params.get('error') !== null
    return { declined: refused, code: refused ? null : params.get('code'), state: refused ? null : params.get('state') }
  })
  const finish = useFinishZoomConnect(code, state)
  const announced = useRef(false)
  const setup = useMyVideoSetup()

  useEffect(() => {
    if (params.size > 0) navigate(ZOOM_RETURN_PATH, { replace: true })
  }, [params, navigate])

  useEffect(() => {
    if (!finish.data || announced.current) return
    announced.current = true
    toast.success(finish.data.email ? t(`${V}.zoom.connectedToast`, { email: finish.data.email }) : t(`${V}.zoom.connectedToastPlain`))
  }, [finish.data])

  let body
  if (setup.isPending || finish.isFetching) {
    body = <Loading />
  } else if (setup.isError && !setup.data) {
    body = <LoadError message={t(`${V}.page.loadError`)} retrying={setup.isFetching} onRetry={() => void setup.refetch()} />
  } else if (!setup.data) {
    return <FullPageMessage role="status" title={t(`${V}.page.notProfessionalTitle`)} body={t(`${V}.page.notProfessionalBody`)} />
  } else {
    body = (
      <>
        <ZoomConnectionCard setup={setup.data} />
        <FixedLinkForm professionalId={setup.data.professional_id} current={setup.data.fixed_url} readOnly={false} />
      </>
    )
  }
  return (
    <div className="max-w-form space-y-5">
      <PageHeader level={1} title={t(`${V}.page.title`)} description={t(`${V}.page.description`)} />
      {declined && <RefusalAlert message={t(`${V}.zoom.declined`)} />}
      {finish.isError && <RefusalAlert message={videoErrorMessage(finish.error)} />}
      {body}
    </div>
  )
}

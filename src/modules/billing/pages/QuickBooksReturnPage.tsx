import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { t } from '@/i18n'
import { SETTINGS_BASE_PATH } from '@/core/settings/paths'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { buttonVariants } from '@/shared/ui/button'
import { toast } from '@/shared/ui/sonner'
import { billingErrorMessage } from '../api/errors'
import { useFinishQboConnect } from '../hooks/use-quickbooks'
import { syncOutcome } from '../lib/qbo-status'

const R = 'modules.billing.qbo.return'

/** Paramètres → QuickBooks (the section's French path). */
export const QBO_SETTINGS_PATH = `${SETTINGS_BASE_PATH}/quickbooks`

/** This page's own address (the functions' RETURN_PATH). */
const RETURN_PATH = '/facturation/retour-quickbooks'

/**
 * `/facturation/retour-quickbooks` (`billing.settings`): where Intuit sends the browser after its
 * consent page, with `?code=&state=&realmId=` (or `?error=access_denied` when the person
 * declined). The page posts the three to `qbo-callback` with the person's own session (the state
 * is signed and names her), then starts the first read and goes back to « QuickBooks », replacing
 * this address so the code never stays in the history. Posted once (`useFinishQboConnect`).
 */
export function QuickBooksReturnPage() {
  usePageTitle(t(`${R}.title`))
  const [params] = useSearchParams()
  const navigate = useNavigate()
  // Read once: the address is then emptied (below), so the code never stays in the history.
  const [{ declined, code, state, realmId }] = useState(() => {
    const refused = params.get('error') !== null
    return {
      declined: refused,
      code: refused ? null : params.get('code'),
      state: refused ? null : params.get('state'),
      realmId: refused ? null : params.get('realmId'),
    }
  })
  const finish = useFinishQboConnect(code, state, realmId)
  const announced = useRef(false)

  useEffect(() => {
    if (params.size > 0) navigate(RETURN_PATH, { replace: true })
  }, [params, navigate])

  useEffect(() => {
    if (!finish.data || announced.current) return
    announced.current = true
    const { company, sync } = finish.data
    toast.success(company.company_name ? t(`${R}.connected`, { company: company.company_name }) : t(`${R}.connectedNoName`))
    if (sync) {
      const outcome = syncOutcome(sync)
      if (outcome.ok) toast.success(outcome.text)
      else toast.error(outcome.text)
    }
    navigate(QBO_SETTINGS_PATH, { replace: true })
  }, [finish.data, navigate])

  const back = (
    <GuardedNavLink to={QBO_SETTINGS_PATH} replace className={buttonVariants({ variant: 'outline' })}>
      {t(`${R}.back`)}
    </GuardedNavLink>
  )
  if (declined) return <FullPageMessage role="status" title={t(`${R}.declinedTitle`)} body={t(`${R}.declinedBody`)} action={back} />
  if (!code || !state || !realmId) {
    return <FullPageMessage role="alert" title={t(`${R}.failedTitle`)} body={t(`${R}.missing`)} action={back} />
  }
  if (finish.isError) {
    return <FullPageMessage role="alert" title={t(`${R}.failedTitle`)} body={billingErrorMessage(finish.error)} action={back} />
  }
  return <FullPageMessage role="status" title={t(`${R}.pendingTitle`)} body={t(`${R}.pendingBody`)} />
}

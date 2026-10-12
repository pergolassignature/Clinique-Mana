import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { t } from '@/i18n'
import { SETTINGS_BASE_PATH } from '@/core/settings/paths'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { buttonVariants } from '@/shared/ui/button'
import { toast } from '@/shared/ui/sonner'
import { communicationsErrorMessage } from '../api/errors'
import { useFinishGmailConnect } from '../hooks/use-mailboxes'
import { syncOutcomeText } from '../lib/mailbox-status'

const R = 'modules.communications.googleReturn'

/** Paramètres → Courriels Gmail (the section's French path). */
export const GMAIL_SETTINGS_PATH = `${SETTINGS_BASE_PATH}/courriels-gmail`

/** This page's own address (the functions' RETURN_PATH). */
const GOOGLE_RETURN_PATH = '/courriels/retour-google'

/**
 * `/courriels/retour-google` (`communications.mailboxes_manage`): where Google sends the browser
 * after its consent page, with `?code=&state=` (or `?error=access_denied` when the person declined).
 * The page posts both to `gmail-callback` with the person's own session (the state is signed and
 * names her: the function refuses it for anyone else), then starts the first sync and goes back
 * to « Courriels Gmail », replacing this address so the code never stays in the history. Posted
 * once (`useFinishGmailConnect`): a second post of the same state would be refused (`link_used`).
 */
export function GoogleReturnPage() {
  usePageTitle(t(`${R}.title`))
  const [params] = useSearchParams()
  const navigate = useNavigate()
  // Read once: the address is then emptied (below), so the code never stays in the history.
  const [{ declined, code, state }] = useState(() => {
    const refused = params.get('error') !== null
    return { declined: refused, code: refused ? null : params.get('code'), state: refused ? null : params.get('state') }
  })
  const finish = useFinishGmailConnect(code, state)
  const announced = useRef(false)

  useEffect(() => {
    if (params.size > 0) navigate(GOOGLE_RETURN_PATH, { replace: true })
  }, [params, navigate])

  useEffect(() => {
    if (!finish.data || announced.current) return
    announced.current = true
    const { mailbox, sync } = finish.data
    toast.success(t(`${R}.connected`, { email: mailbox.email_address }))
    if (sync) {
      const outcome = syncOutcomeText(sync)
      if (outcome.ok) toast.success(outcome.text)
      else toast.error(outcome.text)
    }
    navigate(GMAIL_SETTINGS_PATH, { replace: true })
  }, [finish.data, navigate])

  const back = (
    <GuardedNavLink to={GMAIL_SETTINGS_PATH} replace className={buttonVariants({ variant: 'outline' })}>
      {t(`${R}.back`)}
    </GuardedNavLink>
  )
  if (declined) return <FullPageMessage role="status" title={t(`${R}.declinedTitle`)} body={t(`${R}.declinedBody`)} action={back} />
  if (!code || !state) return <FullPageMessage role="alert" title={t(`${R}.failedTitle`)} body={t(`${R}.missing`)} action={back} />
  if (finish.isError) {
    return <FullPageMessage role="alert" title={t(`${R}.failedTitle`)} body={communicationsErrorMessage(finish.error)} action={back} />
  }
  return <FullPageMessage role="status" title={t(`${R}.pendingTitle`)} body={t(`${R}.pendingBody`)} />
}

import { matchPath } from 'react-router-dom'
import { consentPublicPage } from '@/modules/clients'
import { lazyPage, type LazyPage } from '@/shared/lib/lazy-page'

/** `/connexion/confirmer`: where the auth emails land (design §5). Public, code-split. */
export const ConfirmPage = lazyPage(() => import('@/core/auth/pages/ConfirmPage'), 'ConfirmPage')

/** `/invitation`: where a staff invitation email lands (design §4). Public, code-split. */
export const InvitationPage = lazyPage(() => import('@/core/invitations/pages/InvitationPage'), 'InvitationPage')

/** `/consentement`: where a client consent request email lands (Clients C5a). Public, code-split. */
export const ConsentPage = consentPublicPage

/** The code-split public pages, by their exact path. */
const PUBLIC_PAGES: { path: string; component: LazyPage }[] = [
  { path: '/connexion/confirmer', component: ConfirmPage },
  { path: '/invitation', component: InvitationPage },
  { path: '/consentement', component: ConsentPage },
]

/** The code-split public page at `pathname` (exact path only), if any. */
export function publicPageAt(pathname: string): LazyPage | undefined {
  return PUBLIC_PAGES.find((page) => matchPath(page.path, pathname))?.component
}

import { matchPath } from 'react-router-dom'
import { confirmAppointmentPublicPage } from '@/modules/appointments'
import { cardSetupPublicPage, payPublicPage } from '@/modules/billing'
import { consentPublicPage } from '@/modules/clients'
import { bookingCancelPublicPage, bookingPublicPage, propositionPublicPage, waitlistAnswerPublicPage } from '@/modules/demandes'
import { lazyPage, type LazyPage } from '@/shared/lib/lazy-page'

/** `/connexion/confirmer`: where the auth emails land (design §5). Public, code-split. */
export const ConfirmPage = lazyPage(() => import('@/core/auth/pages/ConfirmPage'), 'ConfirmPage')

/** `/invitation`: where a staff invitation email lands (design §4). Public, code-split. */
export const InvitationPage = lazyPage(() => import('@/core/invitations/pages/InvitationPage'), 'InvitationPage')

/** `/consentement`: where a client consent request email lands (Clients C5a). Public, code-split. */
export const ConsentPage = consentPublicPage

/** `/appel-decouverte`: the discovery-call booking page that replaces Calendly (Demandes D3c). Public, code-split. */
export const BookingPage = bookingPublicPage

/** `/appel-decouverte/annuler`: the booking confirmation's cancel link (Demandes D3c). Public, code-split. */
export const BookingCancelPage = bookingCancelPublicPage

/** `/liste-attente/reponse`: the waiting list's « still waiting? » link (Demandes D3). Public, code-split. */
export const WaitlistAnswerPage = waitlistAnswerPublicPage

/** `/proposition`: a proposal's link — a professional and the slots held for the person (Demandes D3b). Public, code-split. */
export const PropositionPage = propositionPublicPage

/** `/rendez-vous/confirmer`: « Confirmer ma présence » from an appointment email (Rendez-vous R4). Public, code-split. */
export const ConfirmAppointmentPage = confirmAppointmentPublicPage

/** `/carte`: « Enregistrer ma carte » from the card email (Facturation FS). Public, code-split. */
export const CardSetupPage = cardSetupPublicPage

/** `/payer`: « Payer en ligne » from an invoice email (Facturation FS). Public, code-split. */
export const PayPage = payPublicPage

/** The code-split public pages, by their exact path. */
const PUBLIC_PAGES: { path: string; component: LazyPage }[] = [
  { path: '/connexion/confirmer', component: ConfirmPage },
  { path: '/invitation', component: InvitationPage },
  { path: '/consentement', component: ConsentPage },
  { path: '/appel-decouverte', component: BookingPage },
  { path: '/appel-decouverte/annuler', component: BookingCancelPage },
  { path: '/liste-attente/reponse', component: WaitlistAnswerPage },
  { path: '/proposition', component: PropositionPage },
  { path: '/rendez-vous/confirmer', component: ConfirmAppointmentPage },
  { path: '/carte', component: CardSetupPage },
  { path: '/payer', component: PayPage },
]

/** The code-split public page at `pathname` (exact path only), if any. */
export function publicPageAt(pathname: string): LazyPage | undefined {
  return PUBLIC_PAGES.find((page) => matchPath(page.path, pathname))?.component
}

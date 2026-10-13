import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'

/**
 * « Visites et paiements »: filled by Rendez-vous (R5) and Facturation (F2). Until then it says
 * where the history lives today (GOrendezvous), plainly.
 */
export function VisitsTab() {
  return <EmptyState title={t('modules.clients.record.visits.title')} body={t('modules.clients.record.visits.body')} />
}

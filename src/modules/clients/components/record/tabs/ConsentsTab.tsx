import { t } from '@/i18n'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ClientConsentsPanel } from '../../consents/ClientConsentsPanel'
import { useClientRecordData } from '../record-context'

/**
 * « Consentements »: C5a's panel for this file (each consent's state, the signed PDF, « Envoyer » /
 * « Renvoyer » / « Annuler la demande » with clients.manage). It reads its own queries
 * (`consentKeys`), not the record's bundle.
 */
export function ConsentsTab() {
  const { summary } = useClientRecordData()
  return (
    <SettingsCard as="section" title={t('modules.clients.record.consents.title')} description={t('modules.clients.record.consents.description')}>
      <ClientConsentsPanel clientId={summary.client.id} />
    </SettingsCard>
  )
}

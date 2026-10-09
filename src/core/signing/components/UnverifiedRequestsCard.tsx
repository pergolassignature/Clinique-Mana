import { t } from '@/i18n'
import type { UnverifiedSignatureRequest } from '@/core/signing/api'
import { useUnverifiedSignatureRequests } from '@/core/signing/hooks'
import { moduleLabel, syncFailureLabel } from '@/core/signing/labels'
import { LoadError } from '@/shared/components/LoadState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatClinicDateTime } from '@/shared/lib/timezone'

/**
 * « Demandes non vérifiées » (`settings.integrations_manage` only: the caller of `enabled`): the
 * requests the hourly reconcile has not read successfully for over 6 hours, the list the
 * `core.signing_requests_unverified` notice points to (`…_core_signing_blind_alert`). Each names
 * the request (its title when the caller may see it, else its module), its last successful read since the send,
 * since when it fails and why. Nothing while loading or when the list is empty; a failed read
 * shows, so a problem is never hidden by its own list. No link: no record type that signs has a
 * page to open yet (a subject route goes here when one does).
 */
export function UnverifiedRequestsCard({ enabled }: { enabled: boolean }) {
  const query = useUnverifiedSignatureRequests(enabled)
  if (!enabled || query.isPending) return null
  if (query.isError && !query.data) {
    return (
      <SettingsCard as="section" title={t('settings.signing.unverified.title')}>
        <LoadError message={t('settings.signing.unverified.loadError')} retrying={query.isFetching} onRetry={() => void query.refetch()} />
      </SettingsCard>
    )
  }
  if (query.data.length === 0) return null
  return (
    <SettingsCard as="section" title={t('settings.signing.unverified.title')} description={t('settings.signing.unverified.description')}>
      <ul className="divide-y divide-border">
        {query.data.map((request) => (
          <UnverifiedRequest key={request.id} request={request} />
        ))}
      </ul>
    </SettingsCard>
  )
}

function UnverifiedRequest({ request }: { request: UnverifiedSignatureRequest }) {
  const date = (value: string | null) => (value ? formatClinicDateTime(value) : t('settings.signing.unverified.never'))
  return (
    <li className="space-y-1 py-3 first:pt-0 last:pb-0">
      <p className="text-sm font-medium">
        {request.title ?? t('settings.signing.unverified.hiddenTitle', { module: moduleLabel(request.module_key) })}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        <dt className="text-muted-foreground">{t('settings.signing.unverified.lastSuccess')}</dt>
        <dd>{date(request.synced_at)}</dd>
        {request.failing_since && (
          <>
            <dt className="text-muted-foreground">{t('settings.signing.unverified.failingSince')}</dt>
            <dd>{formatClinicDateTime(request.failing_since)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('settings.signing.unverified.reason')}</dt>
        <dd>{syncFailureLabel(request.error_code)}</dd>
      </dl>
    </li>
  )
}

import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { ScheduledJobState } from '@/core/jobs/components/ScheduledJobState'
import { SecretField } from '@/core/settings/components/SecretField'
import { WebhookAddressField } from '@/core/settings/components/WebhookAddressField'
import { useSettingsSection } from '@/core/settings/section-context'
import { useOrgSecretKeys } from '@/core/settings/secrets/hooks'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { stripeWebhookUrl } from '../../lib/stripe'

const S = 'modules.billing.stripe.settings'
const JOB = 'billing.stripe_charges'

/**
 * Paramètres → Paiements en ligne (FS; seen with billing.settings, the keys changed with
 * settings.integrations_manage): the clinic's Stripe keys (write-only: « Configurée le … », never a
 * value), the webhook address to give Stripe with its events, and the next-day charge job.
 */
export function OnlinePaymentsSettingsPage() {
  const { readOnly } = useSettingsSection()
  const { can } = useAccess()
  const { org_id: orgId } = useReadyAccess()
  const keysReadOnly = readOnly || !can('settings.integrations_manage')
  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${S}.title`)} description={t(`${S}.description`)} />
      {readOnly && <ReadOnlyNotice />}
      <SectionSurface>
        <SettingsCard as="section" layout="section" title={t(`${S}.keys.title`)} description={t(`${S}.keys.description`)}>
          <OrgSecret secretKey="stripe_secret_key" label={t(`${S}.keys.secret`)} help={t(`${S}.keys.secretHelp`)} readOnly={keysReadOnly} />
          <OrgSecret secretKey="stripe_webhook_secret" label={t(`${S}.keys.webhook`)} help={t(`${S}.keys.webhookHelp`)} readOnly={keysReadOnly} />
          <WebhookAddressField url={stripeWebhookUrl(orgId)} label={t(`${S}.keys.address`)} help={t(`${S}.keys.addressHelp`)} />
          {keysReadOnly && <p className="text-xs text-muted-foreground">{t(`${S}.keys.readOnly`)}</p>}
        </SettingsCard>
        <SettingsCard as="section" layout="section" title={t(`${S}.job.title`)} description={t(`${S}.job.description`)}>
          {can('settings.view') ? (
            <ScheduledJobState jobKey={JOB} texts={`${S}.job.state`} />
          ) : (
            <p className="text-sm text-muted-foreground">{t(`${S}.job.unknown`)}</p>
          )}
        </SettingsCard>
      </SectionSurface>
    </div>
  )
}

/** A write-only org secret (« Configurée le … », never the value). */
function OrgSecret({ secretKey, label, help, readOnly }: { secretKey: string; label: string; help: string; readOnly: boolean }) {
  const { can } = useAccess()
  const secrets = useOrgSecretKeys()
  if (!can('settings.view')) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{t(`${S}.keys.secretsUnknown`)}</p>
      </div>
    )
  }
  if (secrets.isPending) return <Loading />
  if (secrets.isError && !secrets.data) {
    return <LoadError message={t(`${S}.keys.secretsLoadError`)} retrying={secrets.isFetching} onRetry={() => void secrets.refetch()} />
  }
  const configuredAt = secrets.data.find((secret) => secret.key === secretKey)?.updated_at ?? null
  return <SecretField secretKey={secretKey} label={label} help={help} configuredAt={configuredAt} readOnly={readOnly} />
}

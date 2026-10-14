import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { SecretField } from '@/core/settings/components/SecretField'
import { useOrgSecretKeys } from '@/core/settings/secrets/hooks'
import { LoadError, Loading } from '@/shared/components/LoadState'

const S = 'modules.appointments.video.settings.app'

/**
 * A write-only org secret of one of the module's applications (Zoom, RZ; Google's for the
 * agendas, R6): « Configurée le … », never the value. Without `settings.view` its state is unknown
 * and said so; changed with `settings.integrations_manage` (`readOnly` otherwise).
 */
export function OrgSecretField({ secretKey, label, help, readOnly }: { secretKey: string; label: string; help: string; readOnly: boolean }) {
  const { can } = useAccess()
  const secrets = useOrgSecretKeys()
  if (!can('settings.view')) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{t(`${S}.secretsUnknown`)}</p>
      </div>
    )
  }
  if (secrets.isPending) return <Loading />
  if (secrets.isError && !secrets.data) {
    return <LoadError message={t(`${S}.secretsLoadError`)} retrying={secrets.isFetching} onRetry={() => void secrets.refetch()} />
  }
  const configuredAt = secrets.data.find((secret) => secret.key === secretKey)?.updated_at ?? null
  return <SecretField secretKey={secretKey} label={label} help={help} configuredAt={configuredAt} readOnly={readOnly} />
}

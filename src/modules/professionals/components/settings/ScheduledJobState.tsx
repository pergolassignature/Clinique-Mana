import { CircleAlert, CircleCheck } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { useScheduledJobs, useSetScheduledJobEnabled } from '@/core/jobs/hooks'
import { SETTINGS_BASE_PATH } from '@/core/settings/paths'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'

/** The pages that say whether one of the module's business jobs runs, each with its own words. */
type JobTexts = 'modules.professionals.settings.invitations.job' | 'modules.professionals.settings.requiredDocuments.job'

/**
 * Whether a business job of the module is switched on (off by default, like every business job),
 * read with `settings.view`: « La tâche … est activée : elle passe chaque jour vers 6 h » or, off,
 * what does not happen and « Activer la tâche planifiée » for whoever may switch jobs
 * (`settings.manage`, P4-311), else where it is done (« Ouvrir Tâches planifiées »). Without
 * `settings.view`, the caller shows its `unknown` line instead (« Invitations » P4-311, « Documents
 * requis » P4-509).
 */
export function ScheduledJobState({ jobKey, texts }: { jobKey: string; texts: JobTexts }) {
  const { can } = useAccess()
  const jobs = useScheduledJobs()
  const setEnabled = useSetScheduledJobEnabled()
  if (jobs.isError && !jobs.data) return <LoadError message={t(`${texts}.loadError`)} retrying={jobs.isFetching} onRetry={() => void jobs.refetch()} />
  if (!jobs.data) return <Loading />
  const job = jobs.data.find((j) => j.key === jobKey)
  if (!job) return <p className="text-sm text-muted-foreground">{t(`${texts}.unknown`)}</p>
  if (job.enabled) {
    return (
      <p className="flex items-start gap-2 text-sm text-foreground">
        <CircleCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        {job.local_hour === null ? t(`${texts}.onNoHour`) : t(`${texts}.on`, { hour: String(job.local_hour) })}
      </p>
    )
  }
  const pending = setEnabled.isPending
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-2 text-sm text-foreground">
        <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-strong" />
        {t(`${texts}.off`)}
      </p>
      {can('settings.manage') ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={pending || undefined}
          onClick={ignoreWhenInactive(pending, () => setEnabled.mutate({ key: jobKey, enabled: true }))}
          className={cn(softDisabledClasses, 'max-sm:h-11 aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
        >
          {pending ? t(`${texts}.enabling`) : t(`${texts}.enable`)}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t(`${texts}.askAdmin`)}{' '}
          <GuardedNavLink to={`${SETTINGS_BASE_PATH}/taches-planifiees`} className="text-link underline-offset-[3px] hover:underline">
            {t(`${texts}.openJobs`)}
          </GuardedNavLink>
        </p>
      )}
    </div>
  )
}

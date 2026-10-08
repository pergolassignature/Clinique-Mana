import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { t } from '@/i18n'
import type { JobRun, ScheduledJob } from '@/core/jobs/api'
import {
  useRunningScheduledJobs,
  useRunScheduledJobNow,
  useScheduledJobRuns,
  useScheduledJobs,
  useSetScheduledJobEnabled,
} from '@/core/jobs/hooks'
import { runDetailLabel, runStatusLabel, runStatusTone, runTriggerLabel } from '@/core/jobs/labels'
import { scheduleLabel } from '@/core/jobs/schedule-label'
import { useSettingsSection } from '@/core/settings/section-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { StatusDot } from '@/shared/ui/status-dot'
import { Switch } from '@/shared/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

/** Phone: 8 px cell padding, like the audit journal. */
const PHONE_TABLE = 'max-sm:[&_td]:px-2 max-sm:[&_th]:px-2'

/** Status dot and word; under it, for a failed run, what went wrong. */
function RunStatus({ status, detail }: { status: string; detail: string | null }) {
  const error = status === 'error' ? runDetailLabel(detail) : null
  return (
    <>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <StatusDot tone={runStatusTone(status)} />
        {runStatusLabel(status)}
      </span>
      {error && <span className="block text-xs text-muted-foreground">{error}</span>}
    </>
  )
}

interface JobsTableProps {
  jobs: ScheduledJob[]
  readOnly: boolean
  /** `trigger`: the row's « Exécuter maintenant », where focus returns when the dialog closes. */
  onConfirmRun: (job: ScheduledJob, trigger: HTMLButtonElement) => void
  /** The jobs whose « Exécuter maintenant » is pending. */
  running: ReadonlySet<string>
}

function JobsTable({ jobs, readOnly, onConfirmRun, running }: JobsTableProps) {
  const setEnabled = useSetScheduledJobEnabled()
  const saving = setEnabled.isPending ? setEnabled.variables : undefined
  const idBase = useId()

  return (
    <div className="rounded-lg border border-border">
      <Table aria-label={t('settings.sections.jobs')} scrollLabel={t('settings.jobs.scrollLabel')} className={PHONE_TABLE}>
        <TableHeader>
          <TableRow className="[&>th]:whitespace-nowrap">
            <TableHead>{t('settings.jobs.columns.job')}</TableHead>
            <TableHead className="max-sm:hidden">{t('settings.jobs.columns.schedule')}</TableHead>
            <TableHead>{t('settings.jobs.columns.lastRun')}</TableHead>
            <TableHead>{t('settings.jobs.columns.active')}</TableHead>
            {!readOnly && <TableHead className="sr-only">{t('settings.jobs.columns.actions')}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => {
            const schedule = scheduleLabel(job.schedule, job.local_hour)
            const lastRun = job.last_started_at ? formatClinicDateTime(job.last_started_at) : t('settings.jobs.never')
            const isRunning = running.has(job.key)
            // A disabled business job can't be run now (the server refuses it too).
            const needsEnabling = !job.is_maintenance && !job.enabled
            const alwaysOnId = `${idBase}-${job.key}-always-on`
            const enableFirstId = `${idBase}-${job.key}-enable-first`
            return (
              <TableRow key={job.key}>
                <TableCell className="py-2 align-top sm:min-w-56">
                  <span className="font-medium">{job.label}</span>
                  <span className="block text-xs text-muted-foreground max-sm:hidden">{job.description}</span>
                  {/* On a phone the schedule moves here. */}
                  <span className="block text-xs text-muted-foreground sm:hidden">{schedule}</span>
                </TableCell>
                <TableCell className="min-w-40 align-top max-sm:hidden">{schedule}</TableCell>
                {/* When, then the status dot and word, then what went wrong. */}
                <TableCell className="align-top">
                  <span className={cn('block whitespace-nowrap', !job.last_started_at && 'text-muted-foreground')}>{lastRun}</span>
                  {job.last_status && <RunStatus status={job.last_status} detail={job.last_detail} />}
                </TableCell>
                <TableCell className="align-top">
                  {readOnly ? (
                    <span className="whitespace-nowrap">
                      {job.is_maintenance
                        ? t('settings.jobs.alwaysOn')
                        : job.enabled
                          ? t('settings.jobs.enabled')
                          : t('settings.jobs.disabled')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      {/* Optimistic: the switch shows the requested state while saving. */}
                      <Switch
                        checked={saving?.key === job.key ? saving.enabled : job.enabled}
                        // Maintenance jobs always run (the server refuses the change too).
                        disabled={job.is_maintenance}
                        aria-describedby={job.is_maintenance ? alwaysOnId : undefined}
                        aria-disabled={(!job.is_maintenance && setEnabled.isPending) || undefined}
                        className={cn(setEnabled.isPending && 'cursor-progress')}
                        aria-label={t('settings.jobs.toggleLabel', { label: job.label })}
                        onCheckedChange={(checked) => {
                          if (!setEnabled.isPending) setEnabled.mutate({ key: job.key, enabled: checked })
                        }}
                      />
                      {job.is_maintenance && (
                        <span id={alwaysOnId} className="whitespace-nowrap text-xs text-muted-foreground">
                          {t('settings.jobs.alwaysOn')}
                        </span>
                      )}
                    </span>
                  )}
                </TableCell>
                {!readOnly && (
                  <TableCell className="whitespace-nowrap text-right align-top">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={t('settings.jobs.runNowLabel', { label: job.label })}
                      aria-disabled={isRunning || needsEnabling || undefined}
                      aria-describedby={needsEnabling ? enableFirstId : undefined}
                      onClick={(event) => {
                        const trigger = event.currentTarget
                        ignoreWhenInactive(isRunning || needsEnabling, () => onConfirmRun(job, trigger))(event)
                      }}
                      className={cn(softDisabledClasses, 'max-sm:h-11 aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
                    >
                      {t('settings.jobs.runNow')}
                    </Button>
                    {needsEnabling && (
                      <span id={enableFirstId} className="mt-1 block text-xs text-muted-foreground">
                        {t('settings.jobs.enableFirst')}
                      </span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/** `labels`: job key → label; null while the jobs load, so a run never shows its raw key meanwhile. */
function RunsSection({ labels }: { labels: ReadonlyMap<string, string> | null }) {
  const headingId = useId()
  const endRef = useRef<HTMLParagraphElement>(null)
  const pressedLoadMore = useRef(false)
  const { data, isPending, isError, isFetching, refetch, hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError } =
    useScheduledJobRuns()
  const runs = useMemo<JobRun[]>(() => data?.pages.flat() ?? [], [data])

  // After a « Charger plus » that reached the end, the button goes away: its focus moves to the end line.
  useEffect(() => {
    if (isFetchingNextPage || !pressedLoadMore.current) return
    pressedLoadMore.current = false
    if (!hasNextPage) endRef.current?.focus()
  }, [hasNextPage, isFetchingNextPage])

  let content
  if (isPending || labels === null) {
    content = <Loading />
  } else if (isError && !data) {
    content = <LoadError message={t('settings.jobs.runs.loadError')} retrying={isFetching} onRetry={() => void refetch()} />
  } else if (runs.length === 0) {
    content = <EmptyState title={t('settings.jobs.runs.empty.title')} body={t('settings.jobs.runs.empty.body')} />
  } else {
    content = (
      <div className="rounded-lg border border-border">
        <Table aria-labelledby={headingId} scrollLabel={t('settings.jobs.runs.scrollLabel')} className={PHONE_TABLE}>
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead>{t('settings.jobs.runs.columns.date')}</TableHead>
              <TableHead>{t('settings.jobs.runs.columns.job')}</TableHead>
              <TableHead className="max-sm:hidden">{t('settings.jobs.runs.columns.trigger')}</TableHead>
              <TableHead>{t('settings.jobs.runs.columns.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.id}>
                <TableCell className="whitespace-nowrap align-top">{formatClinicDateTime(run.started_at)}</TableCell>
                <TableCell className="align-top">
                  {labels.get(run.job_key) ?? run.job_key}
                  <span className="block text-xs text-muted-foreground sm:hidden">{runTriggerLabel(run.trigger)}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap align-top max-sm:hidden">{runTriggerLabel(run.trigger)}</TableCell>
                <TableCell className="align-top">
                  <RunStatus status={run.status} detail={run.detail} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {/* A status: the new count is announced when « Charger plus » adds rows. */}
          <p role="status">
            {runs.length === 1 ? t('settings.jobs.runs.countOne') : t('settings.jobs.runs.countOther', { count: String(runs.length) })}
          </p>
          {hasNextPage ? (
            <div className="flex flex-wrap items-center gap-2">
              {isFetchNextPageError && !isFetchingNextPage && <p role="alert">{t('settings.jobs.runs.loadMoreError')}</p>}
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-disabled={isFetchingNextPage || undefined}
                onClick={ignoreWhenInactive(isFetchingNextPage, () => {
                  pressedLoadMore.current = true
                  void fetchNextPage()
                })}
                className={cn(softDisabledClasses, 'max-sm:h-11 aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
              >
                {isFetchingNextPage ? t('settings.jobs.runs.loadingMore') : t('settings.jobs.runs.loadMore')}
              </Button>
            </div>
          ) : (
            <p ref={endRef} tabIndex={-1} className="outline-none">
              {t('settings.jobs.runs.end')}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="space-y-3">
      <h3 id={headingId} className="text-base font-semibold text-foreground">
        {t('settings.jobs.runs.title')}
      </h3>
      {content}
    </section>
  )
}

/**
 * Paramètres → Tâches planifiées (`settings.view`; changes with `settings.manage`). Each job of the
 * clinic with its schedule in clinic time, last run and status, then the latest runs of every job
 * (« Charger plus »). With `settings.manage`: a switch per business job (maintenance jobs always
 * run) and « Exécuter maintenant » after a confirmation. Both lists load in parallel.
 */
export function ScheduledJobsSettingsPage() {
  const { readOnly } = useSettingsSection()
  const { data: jobs, isPending, isError, isFetching, refetch } = useScheduledJobs()
  const runNow = useRunScheduledJobNow()
  const running = useRunningScheduledJobs()
  const [confirming, setConfirming] = useState<ScheduledJob | null>(null)
  // The row's « Exécuter maintenant » that opened the confirmation: focus returns there.
  const runTriggerRef = useRef<HTMLButtonElement | null>(null)
  // Until the jobs load, none; if they fail, the runs fall back to the raw keys.
  const labels = useMemo(() => (isPending ? null : new Map(jobs?.map((job) => [job.key, job.label]))), [isPending, jobs])

  let content
  if (isPending) {
    content = <Loading />
  } else if (isError && !jobs) {
    content = <LoadError message={t('settings.jobs.loadError')} retrying={isFetching} onRetry={() => void refetch()} />
  } else if (jobs.length === 0) {
    content = <EmptyState title={t('settings.jobs.empty')} />
  } else {
    content = (
      <JobsTable
        jobs={jobs}
        readOnly={readOnly}
        onConfirmRun={(job, trigger) => {
          runTriggerRef.current = trigger
          setConfirming(job)
        }}
        running={running}
      />
    )
  }

  return (
    <div className="max-w-content space-y-5">
      <PageHeader title={t('settings.sections.jobs')} description={t('settings.jobs.description')} />
      {readOnly && <ReadOnlyNotice />}
      {content}
      <RunsSection labels={labels} />
      {!readOnly && (
        <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              // Back to the row's « Exécuter maintenant », cancelled or confirmed.
              event.preventDefault()
              const trigger = runTriggerRef.current
              if (trigger?.isConnected) trigger.focus()
            }}
          >
            {confirming && (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('settings.jobs.confirm.title', { label: confirming.label })}</AlertDialogTitle>
                  <AlertDialogDescription>{t('settings.jobs.confirm.body')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => runNow.mutate(confirming.key)}>{t('settings.jobs.confirm.run')}</AlertDialogAction>
                </AlertDialogFooter>
              </>
            )}
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

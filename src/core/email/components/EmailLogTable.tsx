import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { t } from '@/i18n'
import { periodStartOn } from '@/core/audit/period'
import type { EmailLogFilters, EmailLogRow } from '@/core/email/api'
import { useEmailLog, useEmailTemplates } from '@/core/email/hooks'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { StatusDot, type StatusTone } from '@/shared/ui/status-dot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

/** `email_log.status`, in the order of the filter, with the tone of its dot. */
const STATUSES = {
  queued: 'neutral',
  sent: 'neutral',
  delivered: 'success',
  delivery_delayed: 'warning',
  bounced: 'error',
  complained: 'error',
  failed: 'error',
} as const satisfies Record<string, StatusTone>
type Status = keyof typeof STATUSES
const isStatus = (status: string): status is Status => Object.hasOwn(STATUSES, status)

const PERIODS = ['7d', '30d', 'all'] as const
type Period = (typeof PERIODS)[number]

/** Status dot and French word (« Adresse introuvable » for a bounce, P3-5); the raw status otherwise. */
function LogStatus({ status, errorCode }: { status: string; errorCode: string | null }) {
  return (
    <>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <StatusDot tone={isStatus(status) ? STATUSES[status] : 'default'} />
        {isStatus(status) ? t(`settings.email.log.status.${status}`) : status}
      </span>
      {errorCode && <span className="block text-xs text-muted-foreground">{t('settings.email.log.errorCode', { code: errorCode })}</span>}
    </>
  )
}

/**
 * « Historique d'envoi » (`settings.email_manage`, which the page requires): every email the clinic
 * sent, newest first, filtered by template, status and period (from the clinic's midnight). The
 * recipient's address, or « Adresse retirée » once anonymised (24 months, P3-6). « Charger plus »
 * pages on the last row (keyset on `created_at`, `id`).
 */
export function EmailLogTable() {
  const [templateKey, setTemplateKey] = useState('')
  const [status, setStatus] = useState('')
  const [period, setPeriod] = useState<Period>('all')
  const clinicDate = useClinicDate()
  const from = periodStartOn(period, clinicDate)
  const filters = useMemo<EmailLogFilters>(
    () => ({ templateKey: templateKey || null, status: status || null, from }),
    [templateKey, status, from],
  )
  // Both start on the first render: the filter's list never holds the log back.
  const templates = useEmailTemplates()
  const log = useEmailLog(filters)
  const headingId = useId()
  const endRef = useRef<HTMLParagraphElement>(null)
  const pressedLoadMore = useRef(false)
  const rows = useMemo<EmailLogRow[]>(() => log.data?.pages.flat() ?? [], [log.data])
  const { hasNextPage, isFetchingNextPage } = log

  // After a « Charger plus » that reached the end, the button goes away: its focus moves to the end line.
  useEffect(() => {
    if (isFetchingNextPage || !pressedLoadMore.current) return
    pressedLoadMore.current = false
    if (!hasNextPage) endRef.current?.focus()
  }, [hasNextPage, isFetchingNextPage])

  let content
  if (log.isPending) {
    content = <Loading />
  } else if (log.isError && !log.data) {
    content = <LoadError message={t('settings.email.log.loadError')} retrying={log.isFetching} onRetry={() => void log.refetch()} />
  } else if (rows.length === 0) {
    content = <EmptyState title={t('settings.email.log.empty.title')} body={t('settings.email.log.empty.body')} />
  } else {
    content = (
      <div className="rounded-lg border border-border">
        <Table aria-labelledby={headingId} scrollLabel={t('settings.email.log.scrollLabel')} className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead>{t('settings.email.log.columns.date')}</TableHead>
              <TableHead>{t('settings.email.log.columns.template')}</TableHead>
              <TableHead className="max-sm:hidden">{t('settings.email.log.columns.recipient')}</TableHead>
              <TableHead>{t('settings.email.log.columns.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const recipient = row.to_email ?? t('settings.email.log.anonymised')
              const recipientClass = cn('break-all', row.to_email === null && 'text-muted-foreground')
              return (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap align-top">{formatClinicDateTime(row.created_at)}</TableCell>
                  <TableCell className="align-top">
                    {row.template_label}
                    {/* On a phone the recipient moves here. */}
                    <span className={cn('block text-xs sm:hidden', recipientClass)}>{recipient}</span>
                  </TableCell>
                  <TableCell className={cn('align-top max-sm:hidden', recipientClass)}>{recipient}</TableCell>
                  <TableCell className="align-top">
                    <LogStatus status={row.status} errorCode={row.error_code} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <p role="status">
            {rows.length === 1 ? t('settings.email.log.countOne') : t('settings.email.log.countOther', { count: String(rows.length) })}
          </p>
          {hasNextPage ? (
            <div className="flex flex-wrap items-center gap-2">
              {log.isFetchNextPageError && !isFetchingNextPage && <p role="alert">{t('settings.email.log.loadMoreError')}</p>}
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-disabled={isFetchingNextPage || undefined}
                onClick={ignoreWhenInactive(isFetchingNextPage, () => {
                  pressedLoadMore.current = true
                  void log.fetchNextPage()
                })}
                className={cn(softDisabledClasses, 'max-sm:h-11 aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
              >
                {isFetchingNextPage ? t('common.loading') : t('settings.email.log.loadMore')}
              </Button>
            </div>
          ) : (
            <p ref={endRef} tabIndex={-1} className="outline-none">
              {t('settings.email.log.end')}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="space-y-3">
      <h3 id={headingId} className="text-base font-semibold text-foreground">
        {t('settings.email.log.title')}
      </h3>
      <div role="group" aria-label={t('settings.email.log.filters.label')} className="grid gap-3 sm:max-w-form sm:grid-cols-3">
        <FormField label={t('settings.email.log.filters.template')}>
          {(field) => (
            <Select {...field} value={templateKey} onChange={(event) => setTemplateKey(event.target.value)}>
              <option value="">{t('settings.email.log.filters.allTemplates')}</option>
              {templates.data?.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t('settings.email.log.filters.status')}>
          {(field) => (
            <Select {...field} value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{t('settings.email.log.filters.allStatuses')}</option>
              {(Object.keys(STATUSES) as Status[]).map((key) => (
                <option key={key} value={key}>
                  {t(`settings.email.log.status.${key}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t('settings.email.log.filters.period')}>
          {(field) => (
            <Select {...field} value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
              {PERIODS.map((key) => (
                <option key={key} value={key}>
                  {t(`settings.email.log.filters.periods.${key}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </div>
      {content}
    </section>
  )
}

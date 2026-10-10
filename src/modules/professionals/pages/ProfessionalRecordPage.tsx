import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useParams } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { LoadError } from '@/shared/components/LoadState'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Button } from '@/shared/ui/button'
import { Skeleton } from '@/shared/ui/skeleton'
import { RecordActions } from '../components/record/RecordActions'
import { RecordHeader } from '../components/record/RecordHeader'
import { RecordTabs } from '../components/record/RecordTabs'
import { RecordContext, type RecordData } from '../components/record/record-context'
import { preloadRecordTab, visibleRecordTabs } from '../components/record/record-tabs'
import { useProfessionalsCatalog } from '../hooks/use-catalog'
import { useProfessionalOnboarding } from '../hooks/use-invitations'
import { useProfessionalRecord } from '../hooks/use-professional-record'
import { recordPath } from '../lib/constants'
import { fullName } from '../lib/display'

const R = 'modules.professionals.record'

/** A record id; anything else is « introuvable » without a request (the RPC would refuse it, 22P02). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A professional's record (« fiche », design §5.3): the header band and the tabs (sticky), then
 * the open tab with the summary rail (`RecordTabs`), the tab being the URL's last segment. One request for the record (`get_professional_record`), one for its
 * onboarding line (`get_professional_onboarding`, P4-270) and the cached catalogue, all started at
 * mount, with the open tab's chunk and data; the tabs read them from `RecordContext`. An unknown or hidden
 * tab goes to « Aperçu ».
 */
export function ProfessionalRecordPage() {
  const { id = '', onglet } = useParams()
  // Keyed by the id: another record starts with fresh local state (open disclosures, tab panels).
  return UUID.test(id) ? <RecordView key={id} id={id} onglet={onglet} /> : <RecordNotFound />
}

function RecordView({ id, onglet }: { id: string; onglet: string | undefined }) {
  const { can } = useAccess()
  const record = useProfessionalRecord(id)
  const onboarding = useProfessionalOnboarding(id)
  const catalog = useProfessionalsCatalog()
  const tabs = useMemo(() => visibleRecordTabs(can), [can])
  const current = tabs.find((def) => def.tab === onglet)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusHeading = useCallback(() => heading.current?.focus(), [])
  const queryClient = useQueryClient()
  // The tab the URL opens starts its chunk and its data with the record's requests, not once the
  // record has arrived (a deep link to /documents would otherwise wait for both in turn).
  useEffect(() => {
    if (current) preloadRecordTab(current, queryClient, id, can)
  }, [current, queryClient, id, can])

  const data = record.data
  usePageTitle(data ? fullName(data.professional) : t(data === null ? `${R}.notFound.title` : 'modules.professionals.name'), { crumb: Boolean(data) })
  const value = useMemo<RecordData | null>(
    () =>
      data && catalog.data && onboarding.data !== undefined ? { record: data, catalog: catalog.data, onboarding: onboarding.data, focusHeading } : null,
    [data, catalog.data, onboarding.data, focusHeading],
  )

  if (data === null) return <RecordNotFound />
  if (!current) return <Navigate to={recordPath(id)} replace />
  const failed = [record, onboarding, catalog].filter((q) => q.isError && q.data === undefined)
  if (failed.length > 0) {
    return (
      <LoadError message={t(`${R}.loadError`)} onRetry={() => failed.forEach((q) => void q.refetch())} retrying={failed.some((q) => q.isFetching)} />
    )
  }
  if (!value) return <RecordSkeleton />
  return (
    <RecordContext.Provider value={value}>
      <RecordTabs
        id={id}
        current={current}
        tabs={tabs}
        header={(compact) => (
          <RecordHeader record={value.record} onboarding={value.onboarding} catalog={value.catalog} headingRef={heading} actions={<RecordActions />} compact={compact} />
        )}
      />
    </RecordContext.Provider>
  )
}

/** Not a record id, not in the clinic, or not readable: the RPC answers null for all three. */
function RecordNotFound() {
  usePageTitle(t(`${R}.notFound.title`))
  return (
    <FullPageMessage
      title={t(`${R}.notFound.title`)}
      body={t(`${R}.notFound.body`)}
      action={
        <Button asChild variant="outline">
          <Link to="/professionnels">{t(`${R}.notFound.back`)}</Link>
        </Button>
      }
    />
  )
}

/** The header band's shape while the record loads. */
function RecordSkeleton() {
  return (
    <div className="flex items-start gap-3">
      <p role="status" className="sr-only">
        {t('common.loading')}
      </p>
      <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2 pt-1">
        <Skeleton className="h-5 w-48 max-w-full" />
        <Skeleton className="h-3 w-72 max-w-full" />
      </div>
    </div>
  )
}

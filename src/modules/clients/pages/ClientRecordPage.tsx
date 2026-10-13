import { createElement, Suspense, useCallback, useMemo } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Archive, ArchiveRestore } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { RouteBoundary } from '@/shared/components/RouteBoundary'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { lazyPage } from '@/shared/lib/lazy-page'
import { useGuardedTabs } from '@/shared/lib/unsaved-changes-context'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Skeleton } from '@/shared/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { ClientRecordContext, type ClientRecordData } from '../components/record/record-context'
import { useClientRecord, useClientsReference, useSetClientArchived } from '../hooks/use-clients'
import { RECORD_TABS, clientPath, type ClientRecordTab } from '../lib/constants'
import { ageOf, clientNumberLabel, fullName, rateVariantLabel } from '../lib/display'

const R = 'modules.clients.record'

/** A record id; anything else is « introuvable » without a request. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Each tab is its own chunk (lazyPage), read from the record's bundle (never a refetch). */
const PANELS: Record<ClientRecordTab, ReturnType<typeof lazyPage>> = {
  apercu: lazyPage(() => import('../components/record/tabs/OverviewTab'), 'OverviewTab'),
  informations: lazyPage(() => import('../components/record/tabs/InformationTab'), 'InformationTab'),
  proches: lazyPage(() => import('../components/record/tabs/RelationsTab'), 'RelationsTab'),
  'assurance-et-payeurs': lazyPage(() => import('../components/record/tabs/CoverageTab'), 'CoverageTab'),
  'visites-et-paiements': lazyPage(() => import('../components/record/tabs/VisitsTab'), 'VisitsTab'),
}

/**
 * A client's record (plan C3.4): the header (name, pronouns, number, state and flags, tags,
 * « Archiver » / « Restaurer ») and the page-level tabs (real Radix tabs, decision #35), the tab
 * being the URL's last segment (`/clients/:id/<onglet>`). One request for the bundle; the tabs
 * read it from the context. A switch asks first while a card of the open tab is dirty.
 */
export function ClientRecordPage() {
  const { id = '', onglet } = useParams()
  return UUID.test(id) ? <RecordView key={id} id={id} onglet={onglet} /> : <RecordNotFound />
}

function RecordView({ id, onglet }: { id: string; onglet: string | undefined }) {
  const { can } = useAccess()
  const navigate = useNavigate()
  const record = useClientRecord(id)
  const reference = useClientsReference()
  const archive = useSetClientArchived()
  const summary = record.data
  usePageTitle(summary ? fullName(summary.client) : t(summary === null ? `${R}.notFound.title` : 'modules.clients.name'), { crumb: Boolean(summary) })
  const current = RECORD_TABS.find((tab) => tab === onglet)
  const isTab = useCallback((value: string): value is ClientRecordTab => (RECORD_TABS as readonly string[]).includes(value), [])
  const { onValueChange, triggerProps } = useGuardedTabs(current ?? 'apercu', isTab, (tab) => navigate(clientPath(id, tab), { replace: true }))
  const value = useMemo<ClientRecordData | null>(
    () =>
      summary && reference.data
        ? { summary, reference: reference.data, canEdit: can('clients.manage') && !summary.client.mergedIntoId && !summary.client.anonymizedAt }
        : null,
    [summary, reference.data, can],
  )

  if (summary === null) return <RecordNotFound />
  if (!current) return <Navigate to={clientPath(id)} replace />
  const failed = [record, reference].filter((q) => q.isError && q.data === undefined)
  if (failed.length > 0) {
    return <LoadError message={t(`${R}.loadError`)} onRetry={() => failed.forEach((q) => void q.refetch())} retrying={failed.some((q) => q.isFetching)} />
  }
  if (!value) return <RecordSkeleton />

  const { client } = value.summary
  const age = ageOf(client.birthday)
  const archived = client.archivedAt !== null
  return (
    <ClientRecordContext.Provider value={value}>
      <Tabs value={current} onValueChange={onValueChange}>
        <div className="space-y-4">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h1 tabIndex={-1} className="text-xl font-semibold tracking-tight">
                {fullName(client)}
                {client.pronouns && <span className="ml-2 text-sm font-normal text-muted-foreground">({client.pronouns})</span>}
              </h1>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="tabular">{clientNumberLabel(client.clientNumber)}</span>
                {age !== null && <span>{t(`${R}.age`, { age: String(age) })}</span>}
                {client.mergedIntoId ? (
                  <Badge variant="warning">{t(`${R}.merged`)}</Badge>
                ) : client.anonymizedAt ? (
                  <Badge variant="secondary">{t(`${R}.anonymized`)}</Badge>
                ) : archived ? (
                  <Badge variant="secondary">{t(`${R}.archived`)}</Badge>
                ) : (
                  <Badge variant="success">{t(`${R}.active`)}</Badge>
                )}
                {client.isBanned && <Badge variant="error">{t('modules.clients.list.flags.banned')}</Badge>}
                {client.fileIncomplete && <Badge variant="warning">{t('modules.clients.list.flags.incomplete')}</Badge>}
                {client.specialAgreement && <Badge variant="info">{t('modules.clients.list.flags.agreement')}</Badge>}
                {client.taxExempt && <Badge variant="secondary">{t('modules.clients.list.flags.taxExempt')}</Badge>}
                {client.rateVariant && <Badge variant="secondary">{rateVariantLabel(client.rateVariant)}</Badge>}
                {value.summary.tags.map((tag) => (
                  <Badge key={tag.id} variant="outline">
                    {tag.name}
                  </Badge>
                ))}
              </p>
              {client.mergedIntoId && (
                <p className="text-sm">
                  <Link to={clientPath(client.mergedIntoId)} className="text-link underline-offset-2 hover:underline">
                    {t(`${R}.openKept`)}
                  </Link>
                </p>
              )}
            </div>
            {value.canEdit && (
              <Button
                type="button"
                variant="outline"
                aria-disabled={archive.isPending || undefined}
                onClick={ignoreWhenInactive(archive.isPending, () => archive.mutate({ id, archived: !archived }))}
                className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
              >
                {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                {t(archived ? `${R}.restore` : `${R}.archive`)}
              </Button>
            )}
          </header>
          <TabsList aria-label={t(`${R}.tabs.label`)}>
            {RECORD_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab} {...triggerProps(tab)} onPointerEnter={() => void PANELS[tab].preload().catch(() => undefined)}>
                {t(`${R}.tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent key={current} value={current} className="mt-5 min-w-0">
          <h2 className="sr-only">{t(`${R}.tabs.${current}`)}</h2>
          <RouteBoundary scope="clients:record" compact>
            <Suspense fallback={<Loading />}>{createElement(PANELS[current])}</Suspense>
          </RouteBoundary>
        </TabsContent>
      </Tabs>
    </ClientRecordContext.Provider>
  )
}

function RecordNotFound() {
  usePageTitle(t(`${R}.notFound.title`))
  return (
    <FullPageMessage
      title={t(`${R}.notFound.title`)}
      body={t(`${R}.notFound.body`)}
      action={
        <Button asChild variant="outline">
          <Link to="/clients">{t(`${R}.notFound.back`)}</Link>
        </Button>
      }
    />
  )
}

function RecordSkeleton() {
  return (
    <div className="space-y-2">
      <p role="status" className="sr-only">
        {t('common.loading')}
      </p>
      <Skeleton className="h-6 w-56 max-w-full" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  )
}

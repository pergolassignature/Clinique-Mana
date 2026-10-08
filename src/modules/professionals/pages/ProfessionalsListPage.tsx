import { useCallback, useMemo, useRef, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CalendarCheck, ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { t, type TranslationKey } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { CreateProfessionalDialog } from '../components/list/CreateProfessionalDialog'
import { ProfessionalsFilters } from '../components/list/ProfessionalsFilters'
import { ProfessionalsTable } from '../components/list/ProfessionalsTable'
import { useProfessionalsCatalog } from '../hooks/use-catalog'
import { prefetchProfessionalRecord } from '../hooks/use-professional-record'
import { useProfessionalsList } from '../hooks/use-professionals-list'
import { filterProfessionals, paginate, searchHaystacks } from '../lib/filters'
import { useRememberedProfessionalsFilters } from '../lib/remembered-filters'
import { professionalRecordPage } from '../manifest'
import type { ProfessionalListRow } from '../api/parse'

const L = 'modules.professionals.list'

/** « 12 professionnels · 9 actifs » (French: 0 and 1 are singular). */
function subtitle(rows: readonly ProfessionalListRow[]): string {
  const count = (n: number, one: TranslationKey, other: TranslationKey) => t(n > 1 ? other : one, { count: String(n) })
  const active = rows.filter((row) => row.status === 'active').length
  return `${count(rows.length, `${L}.countOne`, `${L}.countOther`)} · ${count(active, `${L}.activeOne`, `${L}.activeOther`)}`
}

/**
 * « Professionnels » (design §5.1, design system §4): the clinic's professionals, filtered in the
 * browser (≤ 500 rows, `professionals_list`) by the URL's filters, which each person finds as they
 * left them (`useRememberedProfessionalsFilters`). The list, the catalogue and the remembered
 * filters load in parallel; rows open the record (prefetched on hover or focus).
 */
export function ProfessionalsListPage() {
  usePageTitle(t('modules.professionals.name'))
  const { can } = useAccess()
  const queryClient = useQueryClient()
  const list = useProfessionalsList()
  const catalog = useProfessionalsCatalog()
  const { filters, setFilters, toggleMotif, setPage, reset, restoring } = useRememberedProfessionalsFilters()
  const filtersButton = useRef<HTMLButtonElement>(null)

  const rows = list.data?.rows
  const catalogView = catalog.data
  // Folded once per list, not on every keystroke.
  const haystacks = useMemo(() => (rows ? searchHaystacks(rows) : undefined), [rows])
  const filtered = useMemo(
    () => (rows && catalogView && haystacks ? filterProfessionals(rows, filters, catalogView, haystacks) : undefined),
    [rows, filters, catalogView, haystacks],
  )
  // Undefined while loading, and while the remembered filters are put in the URL.
  const shown = restoring ? undefined : filtered
  const page = shown ? paginate(shown, filters.page) : undefined

  const prefetch = useCallback(
    (id: string) => {
      void prefetchProfessionalRecord(queryClient, id)
      void professionalRecordPage.preload().catch(() => {
        // Opening the record loads it again and reports a real failure.
      })
    },
    [queryClient],
  )
  // The empty state's « Réinitialiser » goes with the rows it brings back: focus moves to « Filtres ».
  const resetAll = useCallback(() => {
    reset()
    filtersButton.current?.focus()
  }, [reset])

  const failed = [list, catalog].filter((q) => q.isError && !q.data)

  return (
    <>
      <PageHeader
        level={1}
        title={t('modules.professionals.name')}
        description={rows ? subtitle(rows) : undefined}
        actions={
          can('professionals.manage') || can('professionals.compensation') ? (
            <>
              {can('professionals.compensation') && (
                <Button asChild variant="outline">
                  <Link to="/professionnels/revision-mensuelle">
                    <CalendarCheck aria-hidden />
                    {t(`${L}.review`)}
                  </Link>
                </Button>
              )}
              {can('professionals.manage') && <CreateProfessionalDialog />}
            </>
          ) : undefined
        }
      />
      {failed.length > 0 ? (
        <LoadError
          message={t(`${L}.loadError`)}
          onRetry={() => failed.forEach((q) => void q.refetch())}
          retrying={failed.some((q) => q.isFetching)}
        />
      ) : rows?.length === 0 ? (
        <EmptyState title={t(`${L}.empty.title`)} body={t(can('professionals.manage') ? `${L}.empty.body` : `${L}.empty.bodyReadOnly`)} />
      ) : (
        <section aria-label={t(`${L}.table.label`)} className="space-y-3">
          <ProfessionalsFilters
            filters={filters}
            catalog={catalogView}
            resultCount={shown?.length}
            pagination={page && { page: page.page, pageCount: page.pageCount }}
            onChange={setFilters}
            onToggleMotif={toggleMotif}
            onReset={reset}
            filtersButtonRef={filtersButton}
          />
          {list.data?.truncated && (
            <Alert variant="warning">
              <TriangleAlert aria-hidden />
              <AlertDescription className="text-foreground">{t(`${L}.truncated`)}</AlertDescription>
            </Alert>
          )}
          {!shown && (
            <p role="status" className="sr-only">
              {t('common.loading')}
            </p>
          )}
          {shown?.length === 0 ? (
            <EmptyState
              title={t(`${L}.noMatch.title`)}
              body={t(`${L}.noMatch.body`)}
              action={
                <Button variant="outline" onClick={resetAll}>
                  {t(`${L}.reset`)}
                </Button>
              }
            />
          ) : (
            <ProfessionalsTable
              rows={page?.rows ?? null}
              catalog={catalogView}
              onPrefetch={prefetch}
              footer={page && shown && rows && <TableFooter shown={shown.length} total={rows.length} page={page.page} pageCount={page.pageCount} onPage={setPage} />}
            />
          )}
        </section>
      )}
    </>
  )
}

interface TableFooterProps {
  shown: number
  total: number
  page: number
  pageCount: number
  onPage: (page: number) => void
}

/** « 12 sur 40 professionnels » and « ‹ Page 1 sur 2 › » (a page change is a history entry). */
function TableFooter({ shown, total, page, pageCount, onPage }: TableFooterProps) {
  const F = `${L}.footer` as const
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
      <p className="tabular">{t(total > 1 ? `${F}.countOther` : `${F}.countOne`, { shown: String(shown), total: String(total) })}</p>
      <nav aria-label={t(`${F}.pagination`)} className="flex items-center gap-1">
        <PageButton label={t(`${F}.previous`)} inactive={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft aria-hidden />
        </PageButton>
        <span className="tabular whitespace-nowrap">{t(`${F}.page`, { page: String(page), count: String(pageCount) })}</span>
        <PageButton label={t(`${F}.next`)} inactive={page >= pageCount} onClick={() => onPage(page + 1)}>
          <ChevronRight aria-hidden />
        </PageButton>
      </nav>
    </div>
  )
}

/** ‹ or ›. At the first or last page it stays focusable (`aria-disabled`): a press there does nothing. */
function PageButton({ label, inactive, onClick, children }: { label: string; inactive: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-disabled={inactive || undefined}
      onClick={ignoreWhenInactive(inactive, onClick)}
      className={cn(softDisabledClasses, 'aria-disabled:hover:bg-transparent')}
    >
      {children}
    </Button>
  )
}

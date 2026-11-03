import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { fetchApproachCounts } from '../api/approach-counts'
import { professionalCatalogKeys } from '../hooks/keys'

const A = 'modules.professionals.approaches'

/**
 * « Approches » (P4-561, Jonathan: « je veux les comptabiliser mais je ne veux pas les ajouter
 * sur la fiche »): how many active professionals hold each approach the questionnaire offers, the
 * most held first. Counts only — never who, and nothing here reaches a fiche. Linked from the
 * professionals' list; `professionals.view`.
 */
export function ApproachesPage() {
  usePageTitle(t(`${A}.title`))
  const counts = useQuery({ queryKey: professionalCatalogKeys.approachCounts(), queryFn: fetchApproachCounts })
  const rows = counts.data ? [...counts.data].sort((a, b) => b.professionals - a.professionals) : undefined

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to="/professionnels">
          <ChevronLeft aria-hidden />
          {t(`${A}.back`)}
        </Link>
      </Button>
      <PageHeader level={1} title={t(`${A}.title`)} description={t(`${A}.description`)} />
      {counts.isError && !counts.data ? (
        <LoadError message={t(`${A}.loadError`)} onRetry={() => void counts.refetch()} retrying={counts.isFetching} />
      ) : !rows ? (
        <Loading />
      ) : rows.every((r) => r.professionals === 0) ? (
        <EmptyState title={t(`${A}.empty.title`)} body={t(`${A}.empty.body`)} />
      ) : (
        <Table aria-label={t(`${A}.table`)} scrollLabel={t(`${A}.table`)} scrollFocus="overflow">
          <TableHeader>
            <TableRow>
              <TableHead>{t(`${A}.columns.approach`)}</TableHead>
              <TableHead className="text-right">{t(`${A}.columns.professionals`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  {row.name}
                  {!row.isActive && (
                    <Badge variant="secondary" className="ml-2">
                      {t(`${A}.archived`)}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular">{row.professionals}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  )
}

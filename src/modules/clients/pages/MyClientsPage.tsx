import { useId, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { matchesSearch, searchWords } from '@/shared/lib/list-search'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Input } from '@/shared/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { useMyClients } from '../hooks/use-clients'
import { ageOf, clientNumberLabel, languageLabel, phoneLabel } from '../lib/display'

const M = 'modules.clients.mine'

/**
 * « Mes clients » (plan C3, R-8): the professional's clients (created, seen or to be seen, or of
 * whom she is the primary professional), with what she needs to reach them; never staff notes,
 * insurance or payers (`my_clients`). A search on the name, the email and the number.
 */
export function MyClientsPage() {
  usePageTitle(t(`${M}.title`))
  const mine = useMyClients()
  const [query, setQuery] = useState('')
  const searchId = useId()
  const words = searchWords(query)
  const rows = useMemo(
    () => mine.data?.filter((row) => matchesSearch([row.name, row.email ?? '', String(row.clientNumber)], words)),
    [mine.data, words],
  )
  return (
    <>
      <PageHeader level={1} title={t(`${M}.title`)} description={t(`${M}.description`)} />
      {mine.isError && !mine.data ? (
        <LoadError message={t(`${M}.loadError`)} onRetry={() => void mine.refetch()} retrying={mine.isFetching} />
      ) : mine.data?.length === 0 ? (
        <EmptyState title={t(`${M}.empty.title`)} body={t(`${M}.empty.body`)} />
      ) : (
        <section aria-label={t(`${M}.title`)} className="space-y-3">
          <div className="relative max-w-sm">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
            <label htmlFor={searchId} className="sr-only">
              {t(`${M}.searchLabel`)}
            </label>
            <Input id={searchId} type="search" role="searchbox" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(`${M}.search`)} className="pl-8" />
          </div>
          <Table aria-label={t(`${M}.table`)} scrollLabel={t(`${M}.table`)} scrollFocus="overflow">
            <TableHeader>
              <TableRow className="[&>th]:whitespace-nowrap">
                <TableHead>{t(`${M}.columns.name`)}</TableHead>
                <TableHead>{t(`${M}.columns.birthday`)}</TableHead>
                <TableHead>{t(`${M}.columns.contact`)}</TableHead>
                <TableHead className="max-sm:hidden">{t(`${M}.columns.language`)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === undefined ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <p role="status" className="py-2 text-sm text-muted-foreground">
                      {t('common.loading')}
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const age = ageOf(row.birthday)
                  return (
                    <TableRow key={row.id} className={cn(row.isArchived && 'text-muted-foreground')}>
                      <TableCell className="font-medium">
                        {row.name}
                        {row.pronouns && <span className="ml-1 text-xs font-normal text-muted-foreground">({row.pronouns})</span>}
                        <span className="flex flex-wrap gap-x-2 text-xs font-normal text-muted-foreground">
                          <span className="tabular">{clientNumberLabel(row.clientNumber)}</span>
                          {row.isPrimary && <Badge variant="info">{t(`${M}.primary`)}</Badge>}
                          {row.isArchived && <Badge variant="secondary">{t(`${M}.archived`)}</Badge>}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {row.birthday ? (
                          <>
                            {formatDateOnlyShort(row.birthday)}
                            {age !== null && <span className="block text-xs text-muted-foreground">{t('modules.clients.list.age', { age: String(age) })}</span>}
                          </>
                        ) : (
                          <span className="text-muted-foreground">{t('modules.clients.list.noBirthday')}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="block break-all">{row.email ?? ''}</span>
                        <span className="block tabular text-xs text-muted-foreground">{phoneLabel(row.mobile)}</span>
                      </TableCell>
                      <TableCell className="max-sm:hidden">{languageLabel(row.language)}</TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </section>
      )}
    </>
  )
}

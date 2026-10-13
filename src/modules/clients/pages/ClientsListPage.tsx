import { useId, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { useDebouncedValue } from '@/shared/lib/use-debounced-value'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import type { ClientsPageQuery } from '../api/clients'
import type { ClientListRow } from '../api/parse'
import { CreateClientDialog } from '../components/list/CreateClientDialog'
import { useClientsList, useClientsReference } from '../hooks/use-clients'
import { CLIENT_STATUSES, clientPath, type ClientStatusFilter } from '../lib/constants'
import { ageOf, clientNumberLabel, phoneLabel, rateVariantLabel } from '../lib/display'

const L = 'modules.clients.list'

/** The URL's filters: `q`, `statut` (actifs, archives, tous), `professionnel`, `etiquette`. */
const STATUS_PARAM: Record<ClientStatusFilter, string> = { active: 'actifs', archived: 'archives', all: 'tous' }

function readFilters(params: URLSearchParams): ClientsPageQuery {
  const status = (Object.entries(STATUS_PARAM).find(([, value]) => value === params.get('statut'))?.[0] ?? 'active') as ClientStatusFilter
  return { query: params.get('q') ?? '', status, professionalId: params.get('professionnel'), tagId: params.get('etiquette') }
}

/**
 * « Clients » (plan C3.2): the clinic's files, paged on the server (~8 500, keyset by name), with a
 * search on the name, the email, the number and the phones (accents ignored), the state, the
 * primary professional and a tag, all in the URL (a link opens the same list). « Nouveau client »
 * for whoever manages files. Rows open the record.
 */
export function ClientsListPage() {
  usePageTitle(t('modules.clients.name'))
  const { can } = useAccess()
  const [params, setParams] = useSearchParams()
  const filters = readFilters(params)
  const searchId = useId()
  // The search reaches the server 250 ms after the last keystroke; the field shows what is typed.
  const debouncedQuery = useDebouncedValue(filters.query, 250)
  const query = useMemo(() => ({ ...filters, query: debouncedQuery }), [filters.status, filters.professionalId, filters.tagId, debouncedQuery]) // eslint-disable-line react-hooks/exhaustive-deps
  const list = useClientsList(query)
  const reference = useClientsReference()
  const rows = list.data?.pages.flat()
  const filtered = Boolean(filters.query || filters.professionalId || filters.tagId || filters.status !== 'active')

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === '') next.delete(key)
      else next.set(key, value)
    }
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader level={1} title={t('modules.clients.name')} description={t(`${L}.description`)} actions={can('clients.manage') ? <CreateClientDialog /> : undefined} />
      <section aria-label={t(`${L}.label`)} className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
            <label htmlFor={searchId} className="sr-only">
              {t(`${L}.searchLabel`)}
            </label>
            <Input
              id={searchId}
              type="search"
              role="searchbox"
              value={filters.query}
              onChange={(event) => update({ q: event.target.value })}
              placeholder={t(`${L}.search`)}
              autoComplete="off"
              className="pl-8"
            />
          </div>
          <SegmentedToggle
            label={t(`${L}.statusLabel`)}
            value={filters.status}
            onChange={(status) => update({ statut: status === 'active' ? null : STATUS_PARAM[status] })}
            options={CLIENT_STATUSES.map((status) => ({ value: status, label: t(`${L}.status.${status}`) }))}
          />
          <div className="w-field-md max-w-full">
            <Select
              aria-label={t(`${L}.professionalLabel`)}
              value={filters.professionalId ?? ''}
              onChange={(event) => update({ professionnel: event.target.value })}
              placeholder={t(`${L}.allProfessionals`)}
              clearable
            >
              {reference.data?.professionals.map((pro) => (
                <option key={pro.id} value={pro.id}>
                  {pro.name}
                </option>
              ))}
            </Select>
          </div>
          {(reference.data?.tags.length ?? 0) > 0 && (
            <div className="w-field-md max-w-full">
              <Select aria-label={t(`${L}.tagLabel`)} value={filters.tagId ?? ''} onChange={(event) => update({ etiquette: event.target.value })} placeholder={t(`${L}.allTags`)} clearable>
                {reference.data?.tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        {list.isError && !list.data ? (
          <LoadError message={t(`${L}.loadError`)} onRetry={() => void list.refetch()} retrying={list.isFetching} />
        ) : rows && rows.length === 0 ? (
          filtered ? (
            <EmptyState
              title={t(`${L}.noMatch.title`)}
              body={t(`${L}.noMatch.body`)}
              action={
                <Button variant="outline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                  {t(`${L}.reset`)}
                </Button>
              }
            />
          ) : (
            <EmptyState title={t(`${L}.empty.title`)} body={t(can('clients.manage') ? `${L}.empty.body` : `${L}.empty.bodyReadOnly`)} />
          )
        ) : (
          <ClientsTable
            rows={rows ?? null}
            professionals={reference.data?.professionals}
            tags={reference.data?.tags}
            more={list.hasNextPage ? { loading: list.isFetchingNextPage, load: () => void list.fetchNextPage() } : null}
          />
        )}
      </section>
    </>
  )
}

interface ClientsTableProps {
  /** Null while the first page loads. */
  rows: readonly ClientListRow[] | null
  professionals: readonly { id: string; name: string }[] | undefined
  tags: readonly { id: string; name: string }[] | undefined
  more: { loading: boolean; load: () => void } | null
}

/** The files, 50 at a time; « Afficher plus » under the last row while there are more. */
function ClientsTable({ rows, professionals, tags, more }: ClientsTableProps) {
  const proName = (id: string | null) => (id ? (professionals?.find((p) => p.id === id)?.name ?? '') : '')
  const tagName = (id: string) => tags?.find((tag) => tag.id === id)?.name
  return (
    <div className="space-y-3">
      <Table aria-label={t(`${L}.table`)} scrollLabel={t(`${L}.table`)} scrollFocus="overflow" stickyHeader>
        <TableHeader>
          <TableRow className="[&>th]:whitespace-nowrap">
            <TableHead>{t(`${L}.columns.name`)}</TableHead>
            <TableHead className="max-sm:hidden">{t(`${L}.columns.number`)}</TableHead>
            <TableHead>{t(`${L}.columns.birthday`)}</TableHead>
            <TableHead className="max-md:hidden">{t(`${L}.columns.contact`)}</TableHead>
            <TableHead className="max-lg:hidden">{t(`${L}.columns.professional`)}</TableHead>
            <TableHead className="max-md:hidden">{t(`${L}.columns.flags`)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows === null ? (
            <TableRow>
              <TableCell colSpan={6}>
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
                    <Link to={clientPath(row.id)} className="text-link underline-offset-2 hover:underline">
                      {row.firstName} {row.lastName}
                    </Link>
                    {row.isArchived && (
                      <Badge variant="secondary" className="ml-2">
                        {t(`${L}.archived`)}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="tabular whitespace-nowrap max-sm:hidden">{clientNumberLabel(row.clientNumber)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.birthday ? (
                      <>
                        {formatDateOnlyShort(row.birthday)}
                        {age !== null && <span className="block text-xs text-muted-foreground">{t(`${L}.age`, { age: String(age) })}</span>}
                      </>
                    ) : (
                      <span className="text-muted-foreground">{t(`${L}.noBirthday`)}</span>
                    )}
                  </TableCell>
                  <TableCell className="max-md:hidden">
                    <span className="block break-all">{row.email ?? ''}</span>
                    <span className="block tabular text-xs text-muted-foreground">{phoneLabel(row.mobile)}</span>
                  </TableCell>
                  <TableCell className="max-lg:hidden">{proName(row.primaryProfessionalId)}</TableCell>
                  <TableCell className="max-md:hidden">
                    <span className="flex flex-wrap gap-1">
                      {row.isBanned && <Badge variant="error">{t(`${L}.flags.banned`)}</Badge>}
                      {row.fileIncomplete && <Badge variant="warning">{t(`${L}.flags.incomplete`)}</Badge>}
                      {row.specialAgreement && <Badge variant="info">{t(`${L}.flags.agreement`)}</Badge>}
                      {row.taxExempt && <Badge variant="secondary">{t(`${L}.flags.taxExempt`)}</Badge>}
                      {row.rateVariant && <Badge variant="secondary">{rateVariantLabel(row.rateVariant)}</Badge>}
                      {row.tagIds.map((id) => {
                        const name = tagName(id)
                        return name ? (
                          <Badge key={id} variant="outline">
                            {name}
                          </Badge>
                        ) : null
                      })}
                    </span>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
      {more && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            aria-disabled={more.loading || undefined}
            onClick={ignoreWhenInactive(more.loading, more.load)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            {t(more.loading ? `${L}.loadingMore` : `${L}.loadMore`)}
          </Button>
        </div>
      )}
    </div>
  )
}

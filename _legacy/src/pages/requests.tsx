import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Plus, Inbox } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/components/empty-state'
import {
  DemandesTable,
  DemandesFilters,
  useDemandes,
  type DemandesListFilters,
  type DemandesListSort,
} from '@/demandes'

export function RequestsPage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<DemandesListFilters>({})
  const [sort, setSort] = useState<DemandesListSort>({ field: 'createdAt', direction: 'desc' })

  const { data: demandes = [], isLoading } = useDemandes(filters, sort)

  const handleRowClick = (demandeId: string) => {
    navigate({ to: '/demandes/$id', params: { id: demandeId } })
  }

  // Check if truly empty (no demandes at all) vs filtered empty
  const isEmpty = !isLoading && demandes.length === 0 && !filters.search && !filters.status

  return (
    <div className="space-y-6">
      {/* Filters + Action */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex-1">
          <DemandesFilters filters={filters} onFiltersChange={setFilters} />
        </div>
        <Button asChild className="shrink-0">
          <Link to="/demandes/$id" params={{ id: 'nouvelle' }} search={{ from: 'requests' }}>
            <Plus className="h-4 w-4" />
            {t('pages.requests.action')}
          </Link>
        </Button>
      </div>

      {/* Content */}
      {isEmpty ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title={t('pages.requests.empty.title')}
          description={t('pages.requests.empty.description')}
          action={
            <Button asChild>
              <Link to="/demandes/$id" params={{ id: 'nouvelle' }} search={{ from: 'requests' }}>
                <Plus className="h-4 w-4" />
                {t('pages.requests.action')}
              </Link>
            </Button>
          }
        />
      ) : (
        <DemandesTable
          demandes={demandes}
          sort={sort}
          onSortChange={setSort}
          onRowClick={handleRowClick}
          isLoading={isLoading}
        />
      )}
    </div>
  )
}

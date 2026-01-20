import { useState } from 'react'
import { Plus, UserCircle } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/empty-state'
import { Button } from '@/shared/ui/button'
import { ClientTable } from '@/clients/components/client-table'
import { ClientFilters } from '@/clients/components/client-filters'
import { ClientDrawer } from '@/clients/components/client-drawer'
import { useClients } from '@/clients/hooks'
import type { ClientsListFilters, ClientsListSort } from '@/clients/types'

export function ClientsPage() {
  // Filter and sort state
  const [filters, setFilters] = useState<ClientsListFilters>({})
  const [sort, setSort] = useState<ClientsListSort>({ field: 'name', direction: 'asc' })

  // Drawer state
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  // Fetch clients
  const { data: clients = [], isLoading } = useClients(filters, sort)

  const handleRowClick = (clientId: string) => {
    setSelectedClientId(clientId)
    setIsDrawerOpen(true)
  }

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false)
    // Delay clearing the ID to prevent flicker during close animation
    setTimeout(() => setSelectedClientId(null), 200)
  }

  const handleArchive = (clientId: string) => {
    // TODO: Implement archive mutation
    console.log('Archive client:', clientId)
    handleCloseDrawer()
  }

  const handleDelete = (clientId: string) => {
    // TODO: Implement delete mutation
    console.log('Delete client:', clientId)
    handleCloseDrawer()
  }

  const isEmpty = !isLoading && clients.length === 0 && !filters.search && !filters.status && !filters.tags?.length

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <ClientFilters filters={filters} onFiltersChange={setFilters} />
        </div>
        <Button disabled>
          <Plus className="h-4 w-4 mr-2" />
          {t('clients.list.addClient')}
        </Button>
      </div>

      {/* Content */}
      {isEmpty ? (
        <EmptyState
          icon={<UserCircle className="h-8 w-8" />}
          title={t('clients.list.empty.title')}
          description={t('clients.list.empty.description')}
        />
      ) : (
        <ClientTable
          clients={clients}
          sort={sort}
          onSortChange={setSort}
          onRowClick={handleRowClick}
          isLoading={isLoading}
        />
      )}

      {/* Client Detail Drawer */}
      <ClientDrawer
        clientId={selectedClientId}
        isOpen={isDrawerOpen}
        onClose={handleCloseDrawer}
        onArchive={handleArchive}
        onDelete={handleDelete}
      />
    </div>
  )
}

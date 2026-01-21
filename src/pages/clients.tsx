import { useState } from 'react'
import { Plus, UserCircle } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/empty-state'
import { Button } from '@/shared/ui/button'
import { ClientTable } from '@/clients/components/client-table'
import { ClientFilters } from '@/clients/components/client-filters'
import { ClientDrawer } from '@/clients/components/client-drawer'
import { NewClientDrawer, type NewClientFormData } from '@/clients/components/new-client-drawer'
import { useClients, useCreateClient } from '@/clients/hooks'
import { useToast } from '@/shared/hooks/use-toast'
import type { ClientsListFilters, ClientsListSort } from '@/clients/types'

export function ClientsPage() {
  // Filter and sort state
  const [filters, setFilters] = useState<ClientsListFilters>({})
  const [sort, setSort] = useState<ClientsListSort>({ field: 'name', direction: 'asc' })

  // Drawer state
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isNewClientDrawerOpen, setIsNewClientDrawerOpen] = useState(false)

  // Fetch clients
  const { data: clients = [], isLoading } = useClients(filters, sort)
  const createClient = useCreateClient()
  const { toast } = useToast()

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

  const handleCreateClient = async (data: NewClientFormData) => {
    try {
      const result = await createClient.mutateAsync({
        firstName: data.firstName,
        lastName: data.lastName,
        sex: data.sex,
        language: data.language,
        birthday: data.birthday,
        email: data.email,
        cellPhoneCountryCode: data.cellPhoneCountryCode,
        cellPhone: data.cellPhone,
        homePhoneCountryCode: data.homePhoneCountryCode,
        homePhone: data.homePhone,
        workPhoneCountryCode: data.workPhoneCountryCode,
        workPhone: data.workPhone,
        workPhoneExtension: data.workPhoneExtension,
        streetNumber: data.streetNumber,
        streetName: data.streetName,
        apartment: data.apartment,
        city: data.city,
        province: data.province,
        country: data.country,
        postalCode: data.postalCode,
        referredBy: data.referredBy,
        tags: data.tags,
        primaryProfessionalId: data.primaryProfessionalId,
      })

      toast({
        title: 'Client créé',
        description: `${data.firstName} ${data.lastName} (${result.clientId}) a été créé avec succès.`,
      })

      // Optionally open the new client's drawer
      setSelectedClientId(result.clientId)
      setIsDrawerOpen(true)
    } catch (error) {
      console.error('Failed to create client:', error)
      toast({
        title: 'Erreur',
        description: 'Impossible de créer le client. Veuillez réessayer.',
        variant: 'error',
      })
    }
  }

  const isEmpty = !isLoading && clients.length === 0 && !filters.search && !filters.status && !filters.tags?.length

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <ClientFilters filters={filters} onFiltersChange={setFilters} />
        </div>
        <Button onClick={() => setIsNewClientDrawerOpen(true)}>
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
        onViewClient={handleRowClick}
      />

      {/* New Client Drawer */}
      <NewClientDrawer
        open={isNewClientDrawerOpen}
        onOpenChange={setIsNewClientDrawerOpen}
        onSave={handleCreateClient}
      />
    </div>
  )
}

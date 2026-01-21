// src/pages/services.tsx

import { useState, useMemo, useCallback, Fragment } from 'react'
import { Plus, Search, ArrowUpDown, Loader2, List, DollarSign } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { EmptyState } from '@/shared/components/empty-state'
import { toast } from '@/shared/hooks/use-toast'
import {
  ServiceDisclaimerBanner,
  ServiceTableRow,
  ArchiveServiceDialog,
  ServiceEditorDrawer,
  CategoryPricingSection,
  useServices,
  useServicePrices,
  useArchiveService,
  useRestoreService,
  useCreateService,
  useUpdateService,
  type Service,
  type ServiceStatusFilter,
  type ServiceSortOption,
  type ServiceFormData,
  type PricingModel,
} from '@/services-catalog'
import { PRICING_MODEL_LABELS } from '@/services-catalog/constants/pricing-models'

export function ServicesPage() {
  // Filter & sort state
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ServiceStatusFilter>('active')
  const [sortOption, setSortOption] = useState<ServiceSortOption>('order')
  const [activeTab, setActiveTab] = useState<'services' | 'pricing'>('services')

  // Fetch services from database
  const { data: services = [], isLoading, error } = useServices()
  const { data: allPrices = [] } = useServicePrices()

  // Mutations
  const archiveMutation = useArchiveService()
  const restoreMutation = useRestoreService()
  const createMutation = useCreateService()
  const updateMutation = useUpdateService()

  // Editor drawer state
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [selectedService, setSelectedService] = useState<Service | null>(null)

  // Archive dialog state
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
  const [serviceToArchive, setServiceToArchive] = useState<Service | null>(null)

  // Filter by status
  const statusFilteredServices = useMemo(() => {
    switch (statusFilter) {
      case 'active':
        return services.filter((s) => s.isActive)
      case 'archived':
        return services.filter((s) => !s.isActive)
      case 'all':
      default:
        return services
    }
  }, [services, statusFilter])

  // Filter by search
  const searchFilteredServices = useMemo(() => {
    if (!searchQuery.trim()) return statusFilteredServices

    const query = searchQuery.toLowerCase().trim()
    return statusFilteredServices.filter((service) =>
      service.name.toLowerCase().includes(query) ||
      service.description?.toLowerCase().includes(query)
    )
  }, [statusFilteredServices, searchQuery])

  // Sort services
  const sortedServices = useMemo(() => {
    const sorted = [...searchFilteredServices]
    switch (sortOption) {
      case 'name':
        return sorted.sort((a, b) => a.name.localeCompare(b.name, 'fr-CA'))
      case 'duration':
        return sorted.sort((a, b) => (a.duration || 0) - (b.duration || 0))
      case 'price':
        // Sort by whether they have fixed pricing
        return sorted.sort((a, b) => {
          const aFixed = a.pricingModel === 'fixed' ? 0 : 1
          const bFixed = b.pricingModel === 'fixed' ? 0 : 1
          return aFixed - bFixed
        })
      case 'order':
      default:
        return sorted.sort((a, b) => a.displayOrder - b.displayOrder)
    }
  }, [searchFilteredServices, sortOption])

  // Counts for filter badges
  const activeCount = useMemo(() => services.filter((s) => s.isActive).length, [services])
  const archivedCount = useMemo(() => services.filter((s) => !s.isActive).length, [services])

  const hasServices = services.length > 0
  const hasResults = sortedServices.length > 0

  const tabs = [
    { id: 'services' as const, label: t('pages.services.page.tabs.services'), icon: List },
    { id: 'pricing' as const, label: t('pages.services.page.tabs.pricing'), icon: DollarSign },
  ]

  const groupedServices = useMemo(() => {
    const order: PricingModel[] = [
      'fixed',
      'by_profession_category',
      'by_profession_hourly_prorata',
      'rule_cancellation_prorata',
    ]

    return order.map((model) => ({
      model,
      label: t(PRICING_MODEL_LABELS[model] as Parameters<typeof t>[0]),
      services: sortedServices.filter((service) => service.pricingModel === model),
    })).filter((group) => group.services.length > 0)
  }, [sortedServices, t])

  // Get prices for a specific service
  const getServicePrices = useCallback((serviceId: string) => {
    return allPrices.filter(p => p.serviceId === serviceId)
  }, [allPrices])

  const basePriceLookup = useMemo(() => {
    const lookup = new Map<string, number>()
    for (const price of allPrices) {
      if (price.professionCategoryKey !== null) continue
      if (price.durationMinutes !== null) continue
      if (!price.isActive) continue
      lookup.set(price.serviceId, price.priceCents)
    }
    return lookup
  }, [allPrices])

  // Handle create - open drawer in create mode
  const handleCreate = useCallback(() => {
    setSelectedService(null)
    setIsEditorOpen(true)
  }, [])

  // Handle edit - open drawer in edit mode
  const handleEdit = useCallback((service: Service) => {
    setSelectedService(service)
    setIsEditorOpen(true)
  }, [])

  // Handle editor submit (create or update)
  const handleEditorSubmit = useCallback(
    async (data: ServiceFormData): Promise<{ success: boolean; serviceId?: string; error?: Error }> => {
    try {
      if (selectedService) {
        // Edit mode
        const updatedService = await updateMutation.mutateAsync({ id: selectedService.id, input: data })
        return { success: true, serviceId: updatedService.id }
      }

      // Create mode
      const createdService = await createMutation.mutateAsync(data)
      return { success: true, serviceId: createdService.id }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err : new Error('Unknown error') }
    }
  }, [selectedService, createMutation, updateMutation])

  // Handle editor success
  const handleEditorSuccess = useCallback(() => {
    toast({
      title: selectedService ? 'Service modifié' : 'Service créé',
    })
    setSelectedService(null)
  }, [selectedService])

  // Handle archive click
  const handleArchiveClick = useCallback((service: Service) => {
    setServiceToArchive(service)
    setArchiveDialogOpen(true)
  }, [])

  // Handle archive confirm
  const handleArchiveConfirm = useCallback(async () => {
    if (!serviceToArchive) return { success: false }

    try {
      await archiveMutation.mutateAsync(serviceToArchive.id)
      return { success: true }
    } catch {
      return { success: false }
    }
  }, [serviceToArchive, archiveMutation])

  // Handle archive success
  const handleArchiveSuccess = useCallback(() => {
    toast({ title: 'Service archivé' })
    setServiceToArchive(null)
  }, [])

  // Handle restore
  const handleRestore = useCallback(async (service: Service) => {
    try {
      await restoreMutation.mutateAsync(service.id)
      toast({ title: t('pages.services.restore.success') })
    } catch {
      toast({
        title: 'Erreur',
        description: 'Impossible de restaurer ce service.',
        variant: 'error',
      })
    }
  }, [restoreMutation])

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-sage-600" />
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-wine-600">Erreur lors du chargement des services.</p>
        <p className="text-xs text-foreground-muted mt-1">{error.message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with action */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t('pages.services.page.title')}
          </h1>
          <p className="text-sm text-foreground-muted mt-1">
            {t('pages.services.page.subtitle')}
          </p>
        </div>
        {activeTab === 'services' && (
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4" />
            {t('pages.services.page.action')}
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-4 overflow-x-auto sm:space-x-6">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex shrink-0 items-center gap-2 border-b-2 px-1 py-3 text-sm font-medium transition-colors whitespace-nowrap',
                  isActive
                    ? 'border-sage-600 text-sage-600'
                    : 'border-transparent text-foreground-muted hover:border-border hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {activeTab === 'services' && (
        <>
          {/* Disclaimer banner */}
          <ServiceDisclaimerBanner />

          {/* Filters row */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Status filter (segmented control) */}
            <div className="flex items-center gap-0.5 h-10 rounded-xl border border-border-light bg-background-tertiary/40 p-1">
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                className={cn(
                  'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
                  statusFilter === 'active'
                    ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
                    : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
                )}
              >
                {t('pages.services.page.filters.active')}
                <span className="text-[10px] text-foreground-muted">({activeCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('archived')}
                className={cn(
                  'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
                  statusFilter === 'archived'
                    ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
                    : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
                )}
              >
                {t('pages.services.page.filters.archived')}
                <span className="text-[10px] text-foreground-muted">({archivedCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={cn(
                  'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
                  statusFilter === 'all'
                    ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
                    : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
                )}
              >
                {t('pages.services.page.filters.all')}
              </button>
            </div>

            {/* Sort dropdown */}
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4 text-foreground-muted" />
              <Select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as ServiceSortOption)}
                className="w-[140px] h-9"
              >
                <option value="order">{t('pages.services.page.sort.order')}</option>
                <option value="name">{t('pages.services.page.sort.name')}</option>
                <option value="duration">{t('pages.services.page.sort.duration')}</option>
                <option value="price">{t('pages.services.page.sort.price')}</option>
              </Select>
            </div>
          </div>

          {/* Search input */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('pages.services.page.searchPlaceholder')}
              className="pl-9"
            />
          </div>

          {/* Content */}
          {!hasServices ? (
            // Empty state - no services defined at all
            <EmptyState
              title={t('pages.services.empty.title')}
              description={t('pages.services.empty.description')}
              action={
                <Button onClick={handleCreate}>
                  <Plus className="h-4 w-4" />
                  {t('pages.services.page.action')}
                </Button>
              }
            />
          ) : !hasResults ? (
            // No search/filter results
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-foreground-muted">
                {searchQuery.trim()
                  ? t('pages.services.page.noResults')
                  : statusFilter === 'archived'
                    ? 'Aucun service archivé'
                    : 'Aucun service actif'}
              </p>
              {searchQuery.trim() && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setSearchQuery('')}
                  className="mt-2 text-sage-600"
                >
                  Effacer la recherche
                </Button>
              )}
            </div>
          ) : (
            // Table view
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full">
                <thead className="bg-background-secondary/50">
                    <tr className="border-b border-border">
                      <th className="px-4 py-3 text-left text-[10px] font-medium text-foreground-muted uppercase tracking-wider">
                        {t('pages.services.table.name')}
                      </th>
                      <th className="px-4 py-3 text-left text-[10px] font-medium text-foreground-muted uppercase tracking-wider">
                        {t('pages.services.table.duration')}
                      </th>
                      <th className="px-4 py-3 text-left text-[10px] font-medium text-foreground-muted uppercase tracking-wider">
                        {t('pages.services.table.price')}
                      </th>
                      <th className="px-4 py-3 text-left text-[10px] font-medium text-foreground-muted uppercase tracking-wider">
                        {t('pages.services.table.pricingModel')}
                      </th>
                      <th className="px-4 py-3 text-left text-[10px] font-medium text-foreground-muted uppercase tracking-wider">
                        {t('pages.services.table.consent')}
                      </th>
                      <th className="px-4 py-3 text-left text-[10px] font-medium text-foreground-muted uppercase tracking-wider">
                        {t('pages.services.table.taxes')}
                      </th>
                      <th className="px-4 py-3 text-left text-[10px] font-medium text-foreground-muted uppercase tracking-wider">
                        {t('pages.services.table.status')}
                      </th>
                      <th className="px-4 py-3 text-right text-[10px] font-medium text-foreground-muted uppercase tracking-wider">
                        {t('pages.services.table.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedServices.map((group) => (
                      <Fragment key={group.model}>
                        <tr className="bg-background-secondary/40">
                          <td colSpan={8} className="px-4 py-2 text-[11px] font-medium text-foreground-secondary">
                            {t('pages.services.table.groupLabelPrefix')} {group.label}
                          </td>
                        </tr>
                        {group.services.map((service) => (
                          <ServiceTableRow
                            key={service.id}
                            service={service}
                            prices={getServicePrices(service.id)}
                            onEdit={handleEdit}
                            onArchive={handleArchiveClick}
                            onRestore={handleRestore}
                          />
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
            </div>
          )}

          {/* Service count footer */}
          {hasResults && (
            <div className="pt-4 border-t border-border">
              <p className="text-xs text-foreground-muted text-center">
                {sortedServices.length === statusFilteredServices.length
                  ? `${statusFilteredServices.length} services ${statusFilter === 'archived' ? 'archivés' : statusFilter === 'active' ? 'actifs' : 'au total'}`
                  : `${sortedServices.length} sur ${statusFilteredServices.length} services`}
              </p>
            </div>
          )}
        </>
      )}

      {activeTab === 'pricing' && <CategoryPricingSection />}

      {/* Archive confirmation dialog */}
      {serviceToArchive && (
        <ArchiveServiceDialog
          open={archiveDialogOpen}
          onOpenChange={setArchiveDialogOpen}
          serviceName={serviceToArchive.name}
          onConfirm={handleArchiveConfirm}
          onSuccess={handleArchiveSuccess}
        />
      )}

      {/* Service editor drawer */}
      <ServiceEditorDrawer
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        service={selectedService}
        basePriceCents={selectedService ? basePriceLookup.get(selectedService.id) ?? null : null}
        onSubmit={handleEditorSubmit}
        onSuccess={handleEditorSuccess}
      />
    </div>
  )
}

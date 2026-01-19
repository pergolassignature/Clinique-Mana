// src/pages/services.tsx

import { useState, useMemo, useCallback } from 'react'
import { Plus, Search, ArrowUpDown } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { EmptyState } from '@/shared/components/empty-state'
import { toast } from '@/shared/hooks/use-toast'
import {
  MOCK_SERVICES,
  ServiceDisclaimerBanner,
  ServiceTableRow,
  ServiceEditorDrawer,
  ArchiveServiceDialog,
  type Service,
  type ServiceFormData,
  type ServiceStatusFilter,
  type ServiceSortOption,
} from '@/services-catalog'

export function ServicesPage() {
  // Filter & sort state
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ServiceStatusFilter>('active')
  const [sortOption, setSortOption] = useState<ServiceSortOption>('order')

  // Mock services state (in Phase 2, this becomes DB-backed)
  const [services, setServices] = useState<Service[]>(MOCK_SERVICES)

  // Editor drawer state
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingService, setEditingService] = useState<Service | null>(null)

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
        return sorted.sort((a, b) => a.duration - b.duration)
      case 'price':
        return sorted.sort((a, b) => a.price - b.price)
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

  // Handle create
  const handleCreate = useCallback(() => {
    setEditingService(null)
    setEditorOpen(true)
  }, [])

  // Handle edit
  const handleEdit = useCallback((service: Service) => {
    setEditingService(service)
    setEditorOpen(true)
  }, [])

  // Handle archive click
  const handleArchiveClick = useCallback((service: Service) => {
    setServiceToArchive(service)
    setArchiveDialogOpen(true)
  }, [])

  // Handle archive confirm (mock)
  const handleArchiveConfirm = useCallback(async () => {
    if (!serviceToArchive) return { success: false }

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500))

    setServices((prev) =>
      prev.map((s) =>
        s.id === serviceToArchive.id ? { ...s, isActive: false } : s
      )
    )

    return { success: true }
  }, [serviceToArchive])

  // Handle archive success
  const handleArchiveSuccess = useCallback(() => {
    toast({ title: 'Service archivé' })
    setServiceToArchive(null)
  }, [])

  // Handle restore (no confirmation)
  const handleRestore = useCallback(async (service: Service) => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 300))

    setServices((prev) =>
      prev.map((s) =>
        s.id === service.id ? { ...s, isActive: true } : s
      )
    )

    toast({ title: t('pages.services.restore.success') })
  }, [])

  // Handle duplicate
  const handleDuplicate = useCallback((service: Service) => {
    const newService: Service = {
      ...service,
      id: `srv-${Date.now()}`,
      name: `${service.name} (copie)`,
      displayOrder: services.length + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setServices((prev) => [...prev, newService])
    toast({ title: 'Service dupliqué' })
  }, [services.length])

  // Handle form submit (create/edit)
  const handleFormSubmit = useCallback(async (data: ServiceFormData) => {
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 500))

    if (editingService) {
      // Update existing
      setServices((prev) =>
        prev.map((s) =>
          s.id === editingService.id
            ? {
                ...s,
                ...data,
                variants: data.variants.map((v, i) => ({
                  ...v,
                  id: `var-${editingService.id}-${i}`,
                })),
                updatedAt: new Date().toISOString(),
              }
            : s
        )
      )
    } else {
      // Create new
      const newService: Service = {
        id: `srv-${Date.now()}`,
        ...data,
        variants: data.variants.map((v, i) => ({
          ...v,
          id: `var-new-${i}`,
        })),
        isActive: true,
        displayOrder: services.length + 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setServices((prev) => [...prev, newService])
    }

    return { success: true }
  }, [editingService, services.length])

  // Handle form success
  const handleFormSuccess = useCallback(() => {
    toast({
      title: editingService
        ? t('pages.services.edit.success')
        : t('pages.services.create.success'),
    })
    setEditingService(null)
  }, [editingService])

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
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4" />
          {t('pages.services.page.action')}
        </Button>
      </div>

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
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.name')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.duration')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.price')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.mode')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.online')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.status')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-foreground-muted uppercase tracking-wider">
                  {t('pages.services.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedServices.map((service) => (
                <ServiceTableRow
                  key={service.id}
                  service={service}
                  onEdit={handleEdit}
                  onArchive={handleArchiveClick}
                  onRestore={handleRestore}
                  onDuplicate={handleDuplicate}
                />
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
        open={editorOpen}
        onOpenChange={setEditorOpen}
        service={editingService}
        onSubmit={handleFormSubmit}
        onSuccess={handleFormSuccess}
      />
    </div>
  )
}

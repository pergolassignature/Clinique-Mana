import { useState, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Package, Edit3, Loader2, Check, Clock, ChevronDown } from 'lucide-react'
import { t } from '@/i18n'
import type { ProfessionalWithRelations } from '../types'
import { useProfessionalServices, useReplaceProfessionalServices, useProfessionTitles } from '../hooks'
import { useServicesForCategories, useProfessionCategories } from '@/services-catalog'
import { EmptyState } from '@/shared/components/empty-state'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Checkbox } from '@/shared/ui/checkbox'
import { Skeleton } from '@/shared/ui/skeleton'
import { Badge } from '@/shared/ui/badge'
import { useToast } from '@/shared/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'

interface ProfessionalServicesTabProps {
  professional: ProfessionalWithRelations
}

function formatDuration(minutes: number | null): string {
  if (!minutes) return '—'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (remainingMinutes === 0) return `${hours} h`
  return `${hours} h ${remainingMinutes} min`
}

export function ProfessionalServicesTab({ professional }: ProfessionalServicesTabProps) {
  const { toast } = useToast()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set())
  const [filterCategory, setFilterCategory] = useState<string | 'all'>('all')

  // Get profession titles to map profession_title_key to category_key
  const { data: professionTitles = [] } = useProfessionTitles()
  const { data: professionCategories = [] } = useProfessionCategories()

  // Get professional's professions and their categories
  const professionalProfessions = professional.professions || []
  const professionCategoryKeys = useMemo(() => {
    const keys: string[] = []
    for (const prof of professionalProfessions) {
      const title = professionTitles.find((t) => t.key === prof.profession_title_key)
      if (title?.profession_category_key && !keys.includes(title.profession_category_key)) {
        keys.push(title.profession_category_key)
      }
    }
    return keys
  }, [professionalProfessions, professionTitles])

  // Fetch assigned services for this professional
  const {
    data: assignedServices = [],
    isLoading: isLoadingAssigned,
  } = useProfessionalServices(professional.id)

  // Fetch services available for this professional's profession categories
  const { data: servicesByCategory, isLoading: isLoadingServices } = useServicesForCategories(professionCategoryKeys)
  const availableServices = servicesByCategory?.all || []

  // Mutation for replacing services
  const replaceMutation = useReplaceProfessionalServices()

  // Open dialog and initialize selection with ALL available services by default
  const handleOpenDialog = useCallback(() => {
    // If professional has no services assigned yet, auto-select all available
    if (assignedServices.length === 0 && availableServices.length > 0) {
      setSelectedServiceIds(new Set(availableServices.map((s) => s.id)))
    } else {
      // Otherwise use current selection
      const currentIds = new Set(assignedServices.map((s) => s.service_id))
      setSelectedServiceIds(currentIds)
    }
    setFilterCategory('all')
    setIsDialogOpen(true)
  }, [assignedServices, availableServices])

  // Toggle a service in the selection
  const handleToggleService = useCallback((serviceId: string) => {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev)
      if (next.has(serviceId)) {
        next.delete(serviceId)
      } else {
        next.add(serviceId)
      }
      return next
    })
  }, [])

  // Select all services for a category
  const handleSelectAllForCategory = useCallback((categoryKey: string) => {
    const categoryServices = servicesByCategory?.byCategory[categoryKey] || []
    setSelectedServiceIds((prev) => {
      const next = new Set(prev)
      for (const service of categoryServices) {
        next.add(service.id)
      }
      return next
    })
  }, [servicesByCategory])

  // Deselect all services for a category
  const handleDeselectAllForCategory = useCallback((categoryKey: string) => {
    const categoryServices = servicesByCategory?.byCategory[categoryKey] || []
    const categoryServiceIds = new Set(categoryServices.map((s) => s.id))
    setSelectedServiceIds((prev) => {
      const next = new Set(prev)
      for (const id of categoryServiceIds) {
        next.delete(id)
      }
      return next
    })
  }, [servicesByCategory])

  // Save the selection
  const handleSave = useCallback(async () => {
    try {
      await replaceMutation.mutateAsync({
        professional_id: professional.id,
        service_ids: Array.from(selectedServiceIds),
      })
      toast({
        title: t('professionals.services.success'),
      })
      setIsDialogOpen(false)
    } catch (err) {
      toast({
        title: 'Erreur',
        description: 'Impossible de mettre à jour les services.',
        variant: 'error',
      })
    }
  }, [professional.id, selectedServiceIds, replaceMutation, toast])

  // Check if selection has changed
  const hasChanges = useMemo(() => {
    const currentIds = new Set(assignedServices.map((s) => s.service_id))
    if (currentIds.size !== selectedServiceIds.size) return true
    for (const id of selectedServiceIds) {
      if (!currentIds.has(id)) return true
    }
    return false
  }, [assignedServices, selectedServiceIds])

  // Get filtered services based on selected category filter
  const filteredServices = useMemo(() => {
    if (filterCategory === 'all') {
      return availableServices
    }
    return servicesByCategory?.byCategory[filterCategory] || []
  }, [filterCategory, availableServices, servicesByCategory])

  // Get category label helper
  const getCategoryLabel = useCallback((key: string) => {
    return professionCategories.find((c) => c.key === key)?.labelFr || key
  }, [professionCategories])

  if (isLoadingAssigned) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Services Card */}
      <Card className="rounded-2xl">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-sage-600" />
              {t('professionals.services.title')}
            </CardTitle>
            <CardDescription className="mt-1">
              {assignedServices.length === 0
                ? t('professionals.services.empty')
                : `${assignedServices.length} service${assignedServices.length > 1 ? 's' : ''} assigné${assignedServices.length > 1 ? 's' : ''}`}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={handleOpenDialog}>
            <Edit3 className="h-4 w-4" />
            {t('professionals.services.edit')}
          </Button>
        </CardHeader>
        <CardContent>
          {assignedServices.length === 0 ? (
            <EmptyState
              title={t('professionals.services.empty')}
              description="Cliquez sur Modifier pour assigner des services à ce professionnel."
            />
          ) : (
            <ul className="divide-y divide-border">
              {assignedServices.map((ps) => (
                <motion.li
                  key={ps.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sage-100 text-sage-600">
                      <Package className="h-4 w-4" />
                    </div>
                    <span className="font-medium text-foreground">
                      {ps.service.name_fr}
                    </span>
                  </div>
                  {ps.service.default_duration_minutes && (
                    <span className="flex items-center gap-1.5 text-sm text-foreground-muted">
                      <Clock className="h-3.5 w-3.5" />
                      {formatDuration(ps.service.default_duration_minutes)}
                    </span>
                  )}
                </motion.li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Service Selection Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[80vh] overflow-hidden flex flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('professionals.services.dialog.title')}</DialogTitle>
            <DialogDescription>
              {t('professionals.services.dialog.description')}
            </DialogDescription>
          </DialogHeader>

          {/* Category filter when professional has multiple professions */}
          {professionCategoryKeys.length > 1 && (
            <div className="flex items-center gap-2 py-2 border-b border-border">
              <span className="text-sm text-foreground-muted">Filtrer par :</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1">
                    {filterCategory === 'all' ? 'Tous les titres' : getCategoryLabel(filterCategory)}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setFilterCategory('all')}>
                    Tous les titres
                  </DropdownMenuItem>
                  {professionCategoryKeys.map((key) => (
                    <DropdownMenuItem key={key} onClick={() => setFilterCategory(key)}>
                      {getCategoryLabel(key)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Quick select/deselect for current filter */}
              {filterCategory !== 'all' && (
                <div className="flex gap-1 ml-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSelectAllForCategory(filterCategory)}
                  >
                    Tout activer
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeselectAllForCategory(filterCategory)}
                  >
                    Tout désactiver
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto py-4">
            {isLoadingServices ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredServices.length === 0 ? (
              <p className="text-center text-sm text-foreground-muted py-8">
                {professionCategoryKeys.length === 0
                  ? 'Ce professionnel n\'a pas de titre professionnel. Ajoutez un titre pour voir les services disponibles.'
                  : 'Aucun service disponible pour ce titre professionnel.'}
              </p>
            ) : (
              <ul className="space-y-1">
                {filteredServices.map((service) => {
                  const isSelected = selectedServiceIds.has(service.id)
                  // Find which categories this service belongs to
                  const serviceCategoryKeys = professionCategoryKeys.filter(
                    (key) => servicesByCategory?.byCategory[key]?.some((s) => s.id === service.id)
                  )
                  return (
                    <li key={service.id}>
                      <label
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-background-secondary transition-colors"
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleToggleService(service.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {service.name}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            {service.duration && (
                              <span className="text-xs text-foreground-muted">
                                {formatDuration(service.duration)}
                              </span>
                            )}
                            {/* Show category badges when viewing all and has multiple professions */}
                            {filterCategory === 'all' && professionCategoryKeys.length > 1 && serviceCategoryKeys.length > 0 && (
                              <div className="flex gap-1">
                                {serviceCategoryKeys.map((key) => (
                                  <Badge key={key} variant="secondary" className="text-[10px] px-1.5 py-0">
                                    {getCategoryLabel(key)}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        {isSelected && (
                          <Check className="h-4 w-4 text-sage-600 shrink-0" />
                        )}
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={handleSave}
              disabled={replaceMutation.isPending || !hasChanges}
            >
              {replaceMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Enregistrer'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

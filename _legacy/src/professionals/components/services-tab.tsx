import { useState, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Package, Edit3, Loader2, Check, Clock } from 'lucide-react'
import { t } from '@/i18n'
import type { ProfessionalWithRelations } from '../types'
import { useProfessionalServices, useReplaceProfessionalServices, useProfessionTitles } from '../hooks'
import { useServicesForCategories } from '@/services-catalog'
import { EmptyState } from '@/shared/components/empty-state'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Checkbox } from '@/shared/ui/checkbox'
import { Skeleton } from '@/shared/ui/skeleton'
import { useToast } from '@/shared/hooks/use-toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

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
  // Which title is being edited (null = no dialog open)
  const [editingTitleKey, setEditingTitleKey] = useState<string | null>(null)
  // Selected services for the current editing title
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set())

  // Get profession titles to map profession_title_key to category_key
  const { data: professionTitles = [] } = useProfessionTitles()

  // Get professional's professions
  const professionalProfessions = professional.professions || []

  // Map profession title key to category key
  const titleToCategoryMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const prof of professionalProfessions) {
      const title = professionTitles.find((t) => t.key === prof.profession_title_key)
      if (title?.profession_category_key) {
        map[prof.profession_title_key] = title.profession_category_key
      }
    }
    return map
  }, [professionalProfessions, professionTitles])

  // Get all category keys for fetching services
  const professionCategoryKeys = useMemo(() => {
    return [...new Set(Object.values(titleToCategoryMap))]
  }, [titleToCategoryMap])

  // Fetch assigned services for this professional
  const {
    data: assignedServices = [],
    isLoading: isLoadingAssigned,
  } = useProfessionalServices(professional.id)

  // Fetch services available for this professional's profession categories
  const { data: servicesByCategory, isLoading: isLoadingServices } = useServicesForCategories(professionCategoryKeys)

  // Mutation for replacing services
  const replaceMutation = useReplaceProfessionalServices()

  // Get title label
  const getTitleLabel = useCallback((titleKey: string) => {
    const title = professionTitles.find((t) => t.key === titleKey)
    return title?.label_fr || titleKey
  }, [professionTitles])

  // Get services available for a specific title (based on its category)
  const getServicesForTitle = useCallback((titleKey: string) => {
    const categoryKey = titleToCategoryMap[titleKey]
    if (!categoryKey) return []
    return servicesByCategory?.byCategory[categoryKey] || []
  }, [titleToCategoryMap, servicesByCategory])

  // Get assigned services for a specific title
  const getAssignedServicesForTitle = useCallback((titleKey: string) => {
    return assignedServices.filter((ps) => ps.profession_title_key === titleKey)
  }, [assignedServices])

  // Open dialog for editing a specific title's services
  const handleOpenDialog = useCallback((titleKey: string) => {
    const currentServices = getAssignedServicesForTitle(titleKey)
    const availableForTitle = getServicesForTitle(titleKey)

    // If no services assigned yet, auto-select all available
    if (currentServices.length === 0 && availableForTitle.length > 0) {
      setSelectedServiceIds(new Set(availableForTitle.map((s) => s.id)))
    } else {
      setSelectedServiceIds(new Set(currentServices.map((s) => s.service_id)))
    }

    setEditingTitleKey(titleKey)
  }, [getAssignedServicesForTitle, getServicesForTitle])

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

  // Select all services
  const handleSelectAll = useCallback(() => {
    if (!editingTitleKey) return
    const servicesForTitle = getServicesForTitle(editingTitleKey)
    setSelectedServiceIds(new Set(servicesForTitle.map((s) => s.id)))
  }, [editingTitleKey, getServicesForTitle])

  // Deselect all services
  const handleDeselectAll = useCallback(() => {
    setSelectedServiceIds(new Set())
  }, [])

  // Save the selection for the current title
  const handleSave = useCallback(async () => {
    if (!editingTitleKey) return

    try {
      // Build the full servicesByTitle structure
      // Keep other titles unchanged, only update the editing one
      const servicesByTitle: Record<string, string[]> = {}

      for (const prof of professionalProfessions) {
        if (prof.profession_title_key === editingTitleKey) {
          // Use the new selection for this title
          servicesByTitle[prof.profession_title_key] = Array.from(selectedServiceIds)
        } else {
          // Keep existing services for other titles
          const existing = assignedServices
            .filter((ps) => ps.profession_title_key === prof.profession_title_key)
            .map((ps) => ps.service_id)
          servicesByTitle[prof.profession_title_key] = existing
        }
      }

      await replaceMutation.mutateAsync({
        professional_id: professional.id,
        servicesByTitle,
      })
      toast({
        title: t('professionals.services.success'),
      })
      setEditingTitleKey(null)
    } catch (err) {
      toast({
        title: t('common.error'),
        description: t('professionals.services.error.updateFailed'),
        variant: 'error',
      })
    }
  }, [editingTitleKey, professionalProfessions, selectedServiceIds, assignedServices, professional.id, replaceMutation, toast])

  // Check if selection has changed for the current editing title
  const hasChanges = useMemo(() => {
    if (!editingTitleKey) return false
    const currentIds = new Set(
      assignedServices
        .filter((ps) => ps.profession_title_key === editingTitleKey)
        .map((ps) => ps.service_id)
    )
    if (currentIds.size !== selectedServiceIds.size) return true
    for (const id of selectedServiceIds) {
      if (!currentIds.has(id)) return true
    }
    return false
  }, [editingTitleKey, assignedServices, selectedServiceIds])

  // Get services available for the currently editing title
  const editingServices = useMemo(() => {
    if (!editingTitleKey) return []
    return getServicesForTitle(editingTitleKey)
  }, [editingTitleKey, getServicesForTitle])

  if (isLoadingAssigned) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    )
  }

  // No professions - show empty state
  if (professionalProfessions.length === 0) {
    return (
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-sage-600" />
            {t('professionals.services.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            title={t('professionals.services.emptyProfession.title')}
            description={t('professionals.services.emptyProfession.description')}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* One card per profession title */}
      {professionalProfessions.map((prof) => {
        const titleKey = prof.profession_title_key
        const titleLabel = getTitleLabel(titleKey)
        const servicesForTitle = getAssignedServicesForTitle(titleKey)

        return (
          <Card key={titleKey} className="rounded-2xl">
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-sage-600" />
                  {titleLabel}
                </CardTitle>
                <CardDescription className="mt-1">
                  {servicesForTitle.length === 0
                    ? t('professionals.services.empty')
                    : `${servicesForTitle.length} service${servicesForTitle.length > 1 ? 's' : ''}`}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => handleOpenDialog(titleKey)}>
                <Edit3 className="h-4 w-4" />
                {t('professionals.services.edit')}
              </Button>
            </CardHeader>
            <CardContent>
              {servicesForTitle.length === 0 ? (
                <p className="text-sm text-foreground-muted">
                  Cliquez sur Modifier pour assigner des services.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {servicesForTitle.map((ps) => (
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
        )
      })}

      {/* Service Selection Dialog - simple, for one title at a time */}
      <Dialog open={editingTitleKey !== null} onOpenChange={(open) => !open && setEditingTitleKey(null)}>
        <DialogContent className="max-h-[80vh] overflow-hidden flex flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Services pour {editingTitleKey ? getTitleLabel(editingTitleKey) : ''}
            </DialogTitle>
            <DialogDescription>
              {t('professionals.services.dialog.description')}
            </DialogDescription>
          </DialogHeader>

          {/* Quick actions */}
          <div className="flex gap-2 py-2 border-b border-border">
            <Button variant="ghost" size="sm" onClick={handleSelectAll}>
              Tout activer
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDeselectAll}>
              Tout désactiver
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto py-4">
            {isLoadingServices ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : editingServices.length === 0 ? (
              <p className="text-center text-sm text-foreground-muted py-8">
                Aucun service disponible pour ce titre professionnel.
              </p>
            ) : (
              <ul className="space-y-1">
                {editingServices.map((service) => {
                  const isSelected = selectedServiceIds.has(service.id)
                  return (
                    <li key={service.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-background-secondary transition-colors">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleToggleService(service.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {service.name}
                          </p>
                          {service.duration && (
                            <span className="text-xs text-foreground-muted">
                              {formatDuration(service.duration)}
                            </span>
                          )}
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
            <Button variant="outline" onClick={() => setEditingTitleKey(null)}>
              Annuler
            </Button>
            <Button
              onClick={handleSave}
              disabled={replaceMutation.isPending || !hasChanges}
            >
              {replaceMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t('common.save')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

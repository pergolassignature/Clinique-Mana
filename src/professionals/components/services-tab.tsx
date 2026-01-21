import { useState, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Package, Edit3, Loader2, Check, Clock } from 'lucide-react'
import { t } from '@/i18n'
import type { ProfessionalWithRelations } from '../types'
import { useProfessionalServices, useReplaceProfessionalServices } from '../hooks'
import { useActiveServices } from '@/services-catalog'
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
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set())

  // Fetch assigned services for this professional
  const {
    data: assignedServices = [],
    isLoading: isLoadingAssigned,
  } = useProfessionalServices(professional.id)

  // Fetch all active services for the dialog
  const { data: allServices = [], isLoading: isLoadingAll } = useActiveServices()

  // Mutation for replacing services
  const replaceMutation = useReplaceProfessionalServices()

  // Open dialog and initialize selection
  const handleOpenDialog = useCallback(() => {
    const currentIds = new Set(assignedServices.map((s) => s.service_id))
    setSelectedServiceIds(currentIds)
    setIsDialogOpen(true)
  }, [assignedServices])

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

          <div className="flex-1 overflow-y-auto py-4">
            {isLoadingAll ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : allServices.length === 0 ? (
              <p className="text-center text-sm text-foreground-muted py-8">
                Aucun service disponible
              </p>
            ) : (
              <ul className="space-y-1">
                {allServices.map((service) => {
                  const isSelected = selectedServiceIds.has(service.id)
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
                          {service.duration && (
                            <p className="text-xs text-foreground-muted">
                              {formatDuration(service.duration)}
                            </p>
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

// src/availability/components/booking-sidebar.tsx

import { useState, useMemo, useEffect } from 'react'
import { isToday, isTomorrow, startOfDay } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import {
  formatInClinicTimezone,
  toClinicTime,
  getClinicDateString,
} from '@/shared/lib/timezone'
import { useProfessionalProfessions } from '@/professionals/hooks'
import { useProfessionCategories, useProfessionTitles, useServicesForCategories } from '@/services-catalog/hooks'
import type { Appointment, Professional, BookableService, Client } from '../types'
import { ServiceDragItem } from './service-drag-item'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Button } from '@/shared/ui/button'

interface BookingSidebarProps {
  professional: Professional | null
  appointments: Appointment[]
  onAppointmentClick: (appointment: Appointment) => void
  /** All bookable services assigned to this professional */
  bookableServices: BookableService[]
  clients: Client[]
}

function getDateLabel(date: Date): string {
  if (isToday(date)) return "Aujourd'hui"
  if (isTomorrow(date)) return 'Demain'
  return formatInClinicTimezone(date, 'EEEE d MMMM')
}

export function BookingSidebar({
  professional,
  appointments,
  onAppointmentClick,
  bookableServices,
  clients,
}: BookingSidebarProps) {
  // State for selected profession category
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null)

  // Fetch professional's professions
  const { data: professionalProfessions = [] } = useProfessionalProfessions(professional?.id)

  // Fetch profession titles to map profession_title_key → profession_category_key
  const { data: professionTitles = [] } = useProfessionTitles()

  // Fetch profession categories for labels
  const { data: professionCategories = [] } = useProfessionCategories()

  // Extract unique profession category keys for this professional
  const professionCategoryKeys = useMemo(() => {
    const keys: string[] = []
    for (const profession of professionalProfessions) {
      const title = professionTitles.find(t => t.key === profession.profession_title_key)
      if (title?.professionCategoryKey && !keys.includes(title.professionCategoryKey)) {
        keys.push(title.professionCategoryKey)
      }
    }
    return keys
  }, [professionalProfessions, professionTitles])

  // Fetch services for the professional's categories
  const { data: servicesByCategory } = useServicesForCategories(professionCategoryKeys)

  // Auto-select first category when professional changes or categories load
  useEffect(() => {
    const firstCategory = professionCategoryKeys[0]
    if (firstCategory && !selectedCategoryKey) {
      setSelectedCategoryKey(firstCategory)
    }
    // Reset when professional changes
    if (professional?.id && firstCategory && !professionCategoryKeys.includes(selectedCategoryKey || '')) {
      setSelectedCategoryKey(firstCategory)
    }
  }, [professionCategoryKeys, selectedCategoryKey, professional?.id])

  // Get category label helper
  const getCategoryLabel = (key: string) => {
    return professionCategories.find(c => c.key === key)?.labelFr || key
  }

  // Get profession title label for the selected category
  const getProfessionTitleForCategory = (categoryKey: string) => {
    // Find the professional's profession that belongs to this category
    for (const profession of professionalProfessions) {
      const title = professionTitles.find(t => t.key === profession.profession_title_key)
      if (title?.professionCategoryKey === categoryKey) {
        return title.labelFr
      }
    }
    return getCategoryLabel(categoryKey)
  }

  // Filter services based on selected category
  const availableServices = useMemo(() => {
    if (!professional) return []

    // If no professions assigned, show all bookable services (fallback)
    if (professionCategoryKeys.length === 0) return bookableServices

    // If a category is selected, filter services from that category
    if (selectedCategoryKey && servicesByCategory?.byCategory[selectedCategoryKey]) {
      const categoryServiceIds = new Set(
        servicesByCategory.byCategory[selectedCategoryKey].map(s => s.id)
      )
      // Also ensure the service is in the professional's assigned services
      return bookableServices.filter(service => categoryServiceIds.has(service.id))
    }

    return bookableServices
  }, [professional, bookableServices, professionCategoryKeys, selectedCategoryKey, servicesByCategory])

  // Get upcoming appointments (today + next 7 days)
  const upcomingAppointments = useMemo(() => {
    const today = startOfDay(new Date())
    return appointments
      .filter(apt => {
        const aptDate = toClinicTime(apt.startTime)
        return aptDate >= today && apt.status !== 'cancelled'
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, 8)
  }, [appointments])

  // Group by day using clinic timezone
  const groupedByDay = useMemo(() => {
    const groups = new Map<string, Appointment[]>()
    upcomingAppointments.forEach(apt => {
      const dayKey = getClinicDateString(apt.startTime)
      if (!groups.has(dayKey)) groups.set(dayKey, [])
      groups.get(dayKey)!.push(apt)
    })
    return groups
  }, [upcomingAppointments])

  const getService = (id: string) => bookableServices.find(s => s.id === id)
  const getClientNames = (ids: string[]) => {
    if (ids.length === 0) return 'Client a assigner'
    return ids
      .map(id => clients.find(c => c.id === id))
      .filter(Boolean)
      .map(c => `${c!.firstName} ${c!.lastName}`)
      .join(', ')
  }

  // Determine if we should show selector or just label
  const hasMultipleProfessions = professionCategoryKeys.length > 1
  const hasSingleProfession = professionCategoryKeys.length === 1

  return (
    <div className="flex flex-col h-full">
      {/* Services palette */}
      <div className="p-4 border-b border-border">
        {/* Header with profession selector or label */}
        {!professional ? (
          <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
            Services disponibles
          </h3>
        ) : hasSingleProfession && selectedCategoryKey ? (
          // Single profession - show as static label
          <div className="mb-3">
            <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">
              {getProfessionTitleForCategory(selectedCategoryKey)}
            </span>
          </div>
        ) : hasMultipleProfessions ? (
          // Multiple professions - show dropdown selector
          <div className="mb-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-auto p-0 font-semibold text-xs uppercase tracking-wider text-foreground-muted hover:text-foreground gap-1">
                  {selectedCategoryKey ? getProfessionTitleForCategory(selectedCategoryKey) : 'Sélectionner'}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {professionCategoryKeys.map(key => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => setSelectedCategoryKey(key)}
                    className={cn(
                      selectedCategoryKey === key && 'bg-sage-50 text-sage-700'
                    )}
                  >
                    {getProfessionTitleForCategory(key)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
            Services disponibles
          </h3>
        )}

        {/* Services list */}
        {!professional ? (
          <p className="text-sm text-foreground-muted">Sélectionnez un professionnel</p>
        ) : availableServices.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucun service disponible</p>
        ) : (
          <div className="space-y-2">
            {availableServices.map(service => (
              <ServiceDragItem
                key={service.id}
                service={service}
              />
            ))}
          </div>
        )}
      </div>

      {/* Upcoming list */}
      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
          A venir
        </h3>

        {upcomingAppointments.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucun rendez-vous a venir</p>
        ) : (
          <div className="space-y-4">
            {Array.from(groupedByDay.entries()).map(([dayKey, dayApts]) => {
              const firstApt = dayApts[0]
              if (!firstApt) return null
              return (
              <div key={dayKey}>
                <div className="text-xs font-medium text-foreground-secondary mb-2">
                  {getDateLabel(new Date(firstApt.startTime))}
                </div>
                <div className="space-y-1.5">
                  {dayApts.map(apt => {
                    const service = getService(apt.serviceId)
                    const isCreated = apt.status === 'created'
                    return (
                      <button
                        key={apt.id}
                        onClick={() => onAppointmentClick(apt)}
                        className="w-full text-left p-2 rounded-lg hover:bg-background-tertiary/50 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-1 h-8 rounded-full"
                            style={{ backgroundColor: service?.colorHex || '#888' }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className={cn(
                              'text-sm font-medium truncate',
                              isCreated ? 'text-foreground-muted italic' : 'text-foreground'
                            )}>
                              {getClientNames(apt.clientIds)}
                            </div>
                            <div className="text-xs text-foreground-muted">
                              {formatInClinicTimezone(apt.startTime, 'HH:mm')} · {service?.nameFr}
                              {isCreated && ' · En attente'}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )})}
          </div>
        )}
      </div>
    </div>
  )
}

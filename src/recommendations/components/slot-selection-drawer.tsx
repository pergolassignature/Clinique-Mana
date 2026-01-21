// src/recommendations/components/slot-selection-drawer.tsx
// Drawer for selecting an available time slot when assigning a professional

import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  addDays,
  startOfDay,
  format,
  isToday,
  isTomorrow,
  parseISO,
} from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  Calendar,
  Clock,
  Loader2,
  AlertCircle,
  Check,
  Package,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/sheet'
import { Select } from '@/shared/ui/select'
import { fetchAvailabilityBlocks, fetchAppointments } from '@/availability/api'
import type { AvailabilityBlock, Appointment } from '@/availability/types'
import { useProfessionalServices } from '@/professionals/hooks'
import {
  formatInClinicTimezone,
  getClinicDateString,
} from '@/shared/lib/timezone'

interface SlotSelectionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  professionalId: string
  professionalName: string
  /** Callback when a slot is selected */
  onSelectSlot: (slot: AvailableSlot) => void
}

export interface AvailableSlot {
  date: string // YYYY-MM-DD
  startTime: string // ISO datetime
  endTime: string // ISO datetime
  availabilityBlockId: string
  label?: string
  serviceId: string
  serviceName: string
  durationMinutes: number
}

/**
 * Get a human-readable date label.
 */
function getDateLabel(date: Date): string {
  if (isToday(date)) return "Aujourd'hui"
  if (isTomorrow(date)) return 'Demain'
  return format(date, 'EEEE d MMMM', { locale: fr })
}

/**
 * Format time for display.
 */
function formatTime(isoDatetime: string): string {
  return formatInClinicTimezone(isoDatetime, 'HH:mm')
}

/** Internal type for time slot calculation (before service info) */
interface TimeSlot {
  date: string
  startTime: string
  endTime: string
  availabilityBlockId: string
  label?: string
}

/**
 * Calculate available time slots from availability blocks minus existing appointments.
 */
function calculateAvailableTimeSlots(
  blocks: AvailabilityBlock[],
  appointments: Appointment[],
  slotDurationMinutes: number = 60
): TimeSlot[] {
  const slots: TimeSlot[] = []

  for (const block of blocks) {
    // Only consider 'available' type blocks
    if (block.type !== 'available') continue

    const blockStart = parseISO(block.startTime)
    const blockEnd = parseISO(block.endTime)
    const blockDate = getClinicDateString(block.startTime)

    // Get appointments that overlap with this block
    const overlappingAppointments = appointments.filter((apt) => {
      const aptStart = parseISO(apt.startTime)
      const aptEnd = new Date(aptStart.getTime() + apt.durationMinutes * 60000)
      return aptStart < blockEnd && aptEnd > blockStart
    })

    // Simple slot generation: divide block into slots of slotDurationMinutes
    // Skip slots that overlap with existing appointments
    let slotStart = blockStart
    while (slotStart.getTime() + slotDurationMinutes * 60000 <= blockEnd.getTime()) {
      const slotEnd = new Date(slotStart.getTime() + slotDurationMinutes * 60000)

      // Check if this slot overlaps with any appointment
      const hasConflict = overlappingAppointments.some((apt) => {
        const aptStart = parseISO(apt.startTime)
        const aptEnd = new Date(aptStart.getTime() + apt.durationMinutes * 60000)
        return slotStart < aptEnd && slotEnd > aptStart
      })

      if (!hasConflict) {
        slots.push({
          date: blockDate,
          startTime: slotStart.toISOString(),
          endTime: slotEnd.toISOString(),
          availabilityBlockId: block.id,
          label: block.label,
        })
      }

      // Move to next potential slot (30 min increments for flexibility)
      slotStart = new Date(slotStart.getTime() + 30 * 60000)
    }
  }

  return slots
}

/**
 * Group time slots by date.
 */
function groupSlotsByDate(slots: TimeSlot[]): Map<string, TimeSlot[]> {
  const grouped = new Map<string, TimeSlot[]>()

  for (const slot of slots) {
    const existing = grouped.get(slot.date) || []
    existing.push(slot)
    grouped.set(slot.date, existing)
  }

  return grouped
}

/**
 * Drawer component for selecting an available time slot.
 */
export function SlotSelectionDrawer({
  open,
  onOpenChange,
  professionalId,
  professionalName,
  onSelectSlot,
}: SlotSelectionDrawerProps) {
  // Date range for fetching (next 14 days)
  const dateRange = useMemo(() => {
    const today = startOfDay(new Date())
    const startDate = getClinicDateString(today.toISOString())
    const endDate = getClinicDateString(addDays(today, 14).toISOString())
    return { startDate, endDate }
  }, [])

  // Selected time slot state (before service is added)
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<TimeSlot | null>(null)

  // Selected service state
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)

  // Fetch professional's available services
  const {
    data: professionalServices = [],
    isLoading: loadingServices,
  } = useProfessionalServices(open ? professionalId : undefined)

  // Get the selected service details
  const selectedService = useMemo(() => {
    if (!selectedServiceId) return null
    return professionalServices.find((ps) => ps.service_id === selectedServiceId)
  }, [selectedServiceId, professionalServices])

  // Get duration from selected service (default to 50 if not set)
  const serviceDuration = selectedService?.service?.default_duration_minutes || 50

  // Auto-select first service when services load
  useEffect(() => {
    const firstService = professionalServices[0]
    if (firstService && !selectedServiceId) {
      setSelectedServiceId(firstService.service_id)
    }
  }, [professionalServices, selectedServiceId])

  // Fetch availability blocks
  const {
    data: availabilityBlocks = [],
    isLoading: loadingBlocks,
    error: blocksError,
  } = useQuery({
    queryKey: ['availability-blocks', professionalId, dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      fetchAvailabilityBlocks({
        professionalId,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      }),
    enabled: open && !!professionalId,
  })

  // Fetch existing appointments
  const {
    data: appointments = [],
    isLoading: loadingAppointments,
    error: appointmentsError,
  } = useQuery({
    queryKey: ['appointments', professionalId, dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      fetchAppointments({
        professionalId,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        status: ['draft', 'confirmed'],
      }),
    enabled: open && !!professionalId,
  })

  // Calculate available time slots based on selected service duration
  const availableTimeSlots = useMemo(() => {
    if (loadingBlocks || loadingAppointments) return []
    return calculateAvailableTimeSlots(availabilityBlocks, appointments, serviceDuration)
  }, [availabilityBlocks, appointments, loadingBlocks, loadingAppointments, serviceDuration])

  // Group slots by date
  const slotsByDate = useMemo(() => groupSlotsByDate(availableTimeSlots), [availableTimeSlots])

  // Loading state
  const isLoading = loadingBlocks || loadingAppointments
  const error = blocksError || appointmentsError

  // Handle slot confirmation - builds full AvailableSlot with service info
  const handleConfirm = () => {
    if (selectedTimeSlot && selectedService) {
      const fullSlot: AvailableSlot = {
        ...selectedTimeSlot,
        serviceId: selectedService.service_id,
        serviceName: selectedService.service?.name_fr || 'Service',
        durationMinutes: serviceDuration,
      }
      onSelectSlot(fullSlot)
      onOpenChange(false)
      setSelectedTimeSlot(null)
    }
  }

  // Reset selection when drawer closes
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedTimeSlot(null)
      setSelectedServiceId(null)
    }
    onOpenChange(isOpen)
  }

  // Check if we can confirm (need service and time slot)
  const canConfirm = selectedTimeSlot && selectedService

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Choisir un créneau
          </SheetTitle>
          <SheetDescription>
            Sélectionnez un créneau disponible pour {professionalName}
          </SheetDescription>
        </SheetHeader>

        <div className="py-4 space-y-4">
          {/* Service selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Package className="h-4 w-4" />
              Service
            </label>
            {loadingServices ? (
              <div className="flex items-center gap-2 text-sm text-foreground-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement des services...
              </div>
            ) : professionalServices.length === 0 ? (
              <div className="rounded-lg border border-honey-200 bg-honey-50 p-3">
                <p className="text-sm text-honey-800">
                  Ce professionnel n'a pas de service configuré.
                </p>
              </div>
            ) : (
              <Select
                value={selectedServiceId || ''}
                onChange={(e) => setSelectedServiceId(e.target.value || null)}
                placeholder="Sélectionner un service"
              >
                {professionalServices.map((ps) => (
                  <option key={ps.service_id} value={ps.service_id}>
                    {ps.service?.name_fr || 'Service'} ({ps.service?.default_duration_minutes || 50} min)
                  </option>
                ))}
              </Select>
            )}
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-sage-500" />
              <span className="ml-2 text-sm text-foreground-muted">
                Chargement des disponibilités...
              </span>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="rounded-lg border border-wine-200 bg-wine-50 p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-wine-600 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-wine-800">
                    Erreur de chargement
                  </p>
                  <p className="text-xs text-wine-700 mt-1">
                    {error instanceof Error ? error.message : 'Une erreur est survenue'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* No slots available */}
          {!isLoading && !error && availableTimeSlots.length === 0 && selectedServiceId && (
            <div className="rounded-lg border border-honey-200 bg-honey-50 p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-honey-600 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-honey-800">
                    Aucun créneau disponible
                  </p>
                  <p className="text-xs text-honey-700 mt-1">
                    Ce professionnel n'a pas de disponibilité dans les 14 prochains jours pour ce service.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Slots grouped by date */}
          {!isLoading && !error && availableTimeSlots.length > 0 && (
            <div className="space-y-4">
              {Array.from(slotsByDate.entries()).map(([date, slots]) => (
                <div key={date} className="space-y-2">
                  {/* Date header */}
                  <h3 className="text-sm font-medium text-foreground sticky top-0 bg-background py-1">
                    {getDateLabel(parseISO(date))}
                  </h3>

                  {/* Slot buttons */}
                  <div className="grid grid-cols-3 gap-2">
                    {slots.map((slot) => {
                      const isSelected =
                        selectedTimeSlot?.startTime === slot.startTime &&
                        selectedTimeSlot?.date === slot.date
                      return (
                        <button
                          key={`${slot.date}-${slot.startTime}`}
                          type="button"
                          onClick={() => setSelectedTimeSlot(slot)}
                          className={cn(
                            'px-3 py-2 text-sm rounded-lg border transition-all',
                            'hover:border-sage-300 hover:bg-sage-50',
                            'focus:outline-none focus:ring-2 focus:ring-sage-500/30',
                            isSelected
                              ? 'border-sage-500 bg-sage-100 text-sage-800 font-medium'
                              : 'border-border bg-background text-foreground'
                          )}
                        >
                          <Clock className="h-3 w-3 inline mr-1.5" />
                          {formatTime(slot.startTime)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with confirm button */}
        {selectedTimeSlot && (
          <div className="sticky bottom-0 bg-background border-t border-border pt-4 pb-2">
            <div className="rounded-lg border border-sage-200 bg-sage-50 p-3 mb-3">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-sage-600" />
                <div>
                  <p className="text-sm font-medium text-sage-800">
                    Créneau sélectionné
                  </p>
                  <p className="text-xs text-sage-700">
                    {getDateLabel(parseISO(selectedTimeSlot.date))} à{' '}
                    {formatTime(selectedTimeSlot.startTime)}
                    {selectedService && (
                      <span className="ml-1">
                        • {selectedService.service?.name_fr} ({serviceDuration} min)
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setSelectedTimeSlot(null)}
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="default"
                className="flex-1"
                onClick={handleConfirm}
                disabled={!canConfirm}
              >
                Confirmer
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

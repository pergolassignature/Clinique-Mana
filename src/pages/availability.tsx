// src/pages/availability.tsx

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useRouterState, useNavigate } from '@tanstack/react-router'
import { startOfWeek, addDays, format, parseISO } from 'date-fns'
import { DndContext } from '@dnd-kit/core'
import { toast } from '@/shared/hooks/use-toast'
import { Button } from '@/shared/ui/button'
import {
  // Existing components
  CalendarGrid,
  DayView,
  ListView,
  WeekNavigation,
  ProfessionalSelector,

  // New v3 components
  ModeToggle,
  CollapsibleSidebar,
  AvailabilitySidebar,
  BookingSidebar,
  DetailSheet,
  AvailabilityEditor,
  AppointmentEditor,

  // New v3 hooks
  useAvailabilityState,
  useCalendarDnd,

  // Types
  type Appointment,
  type AvailabilityBlock,
  type CalendarMode,
  type CalendarViewMode,
} from '@/availability'
import { CalendarDragOverlay } from '@/availability/dnd'
import { snapToTimeGrid } from '@/availability/dnd/snap-modifier'
import { isoStringToMinutes, minutesToISOString, DEFAULT_CONFIG } from '@/availability/utils/time-grid'
import { useAvailabilityData } from '@/availability/hooks'
import { useProfessionalServices } from '@/professionals/hooks'

interface AvailabilitySearchParams {
  appointmentId?: string
  date?: string
}

export function AvailabilityPage() {
  // Get search params from router
  const routerState = useRouterState()
  const navigate = useNavigate()
  const searchParams = routerState.location.search as AvailabilitySearchParams

  // Load real data from database
  const { professionals, bookableServices, clients } = useAvailabilityData()

  // Professional selection state (defined here so we can use it in hooks below)
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string | null>(null)

  // Fetch services assigned to the selected professional
  const { data: professionalServices = [] } = useProfessionalServices(selectedProfessionalId ?? undefined)

  // Filter bookable services to only those assigned to the selected professional
  const professionalBookableServices = useMemo(() => {
    // If professional has no services assigned, show all services (fallback)
    if (professionalServices.length === 0) return bookableServices

    // Only show services that are assigned to this professional
    const assignedServiceIds = new Set(professionalServices.map(ps => ps.service_id))
    return bookableServices.filter(service => assignedServiceIds.has(service.id))
  }, [bookableServices, professionalServices])

  // View state
  const [viewDate, setViewDate] = useState<Date>(() => new Date())
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week')

  // Mode state (v3)
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('booking')
  const [showAvailabilityOverlay, setShowAvailabilityOverlay] = useState(false)

  // Detail sheet state (v3)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetContent, setSheetContent] = useState<'availability' | 'appointment' | null>(null)
  const [selectedBlock, setSelectedBlock] = useState<AvailabilityBlock | null>(null)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)


  // Use new availability state management hook (v3)
  const {
    availabilityBlocks,
    appointments,
    createAvailabilityBlock,
    updateAvailabilityBlock,
    deleteAvailabilityBlock,
    createAppointment,
    updateAppointment,
    cancelAppointment,
    restoreAppointment,
  } = useAvailabilityState()

  // Filter appointments and blocks for selected professional
  const professionalAppointments = useMemo(() => {
    if (!selectedProfessionalId) return []
    return appointments.filter(apt => apt.professionalId === selectedProfessionalId)
  }, [appointments, selectedProfessionalId])

  const professionalBlocks = useMemo(() => {
    if (!selectedProfessionalId) return []
    return availabilityBlocks.filter(block => block.professionalId === selectedProfessionalId)
  }, [availabilityBlocks, selectedProfessionalId])

  // Get selected professional object
  const selectedProfessional = useMemo(() => {
    return professionals.find(p => p.id === selectedProfessionalId) || null
  }, [professionals, selectedProfessionalId])

  // Auto-select first professional when data loads
  useMemo(() => {
    const firstProfessional = professionals[0]
    if (!selectedProfessionalId && firstProfessional) {
      setSelectedProfessionalId(firstProfessional.id)
    }
  }, [professionals, selectedProfessionalId])

  // Week start for navigation
  const weekStartDate = useMemo(() => {
    return startOfWeek(viewDate, { weekStartsOn: 1 })
  }, [viewDate])

  // Handle search params to auto-open appointment and navigate to date
  useEffect(() => {
    // Handle date param - navigate to that week
    if (searchParams.date) {
      const targetDate = parseISO(searchParams.date)
      if (!isNaN(targetDate.getTime())) {
        setViewDate(targetDate)
      }
    }

    // Handle appointmentId param - find and open the appointment
    if (searchParams.appointmentId && appointments.length > 0) {
      const appointment = appointments.find(apt => apt.id === searchParams.appointmentId)
      if (appointment) {
        // Select the professional for this appointment
        setSelectedProfessionalId(appointment.professionalId)
        // Navigate to the appointment's date
        setViewDate(parseISO(appointment.startTime))
        // Open the appointment detail sheet
        setSelectedAppointment(appointment)
        setSheetContent('appointment')
        setSheetOpen(true)
        // Clear the search params to avoid re-opening on re-render
        navigate({ to: '/disponibilites', search: {}, replace: true })
      }
    }
  }, [searchParams.appointmentId, searchParams.date, appointments, navigate])

  // Helper: Get target date from dayIndex
  const getTargetDate = useCallback((dayIndex: number) => {
    return viewMode === 'day' ? viewDate : addDays(weekStartDate, dayIndex)
  }, [viewMode, viewDate, weekStartDate])

  // =============================================================================
  // dnd-kit Callbacks
  // =============================================================================

  const handleAvailabilityCreate = useCallback(
    (dayIndex: number, startMinutes: number, endMinutes: number) => {
      const targetDate = getTargetDate(dayIndex)
      const startTime = minutesToISOString(startMinutes, targetDate)
      const endTime = minutesToISOString(endMinutes, targetDate)

      // Create the block silently (no modal during drag)
      createAvailabilityBlock({
        professionalId: selectedProfessionalId || '',
        type: 'available',
        startTime,
        endTime,
        isRecurring: false,
        visibleToClients: true,
      })

      toast({
        title: 'Disponibilité créée',
        description: `${format(new Date(startTime), 'HH:mm')} - ${format(new Date(endTime), 'HH:mm')}`,
      })
    },
    [getTargetDate, selectedProfessionalId, createAvailabilityBlock]
  )

  const handleAvailabilityMove = useCallback(
    (blockId: string, dayIndex: number, newStartMinutes: number) => {
      const block = availabilityBlocks.find(b => b.id === blockId)
      if (!block) return

      const oldStartMinutes = isoStringToMinutes(block.startTime)
      const oldEndMinutes = isoStringToMinutes(block.endTime)
      const duration = oldEndMinutes - oldStartMinutes

      const targetDate = getTargetDate(dayIndex)
      const newStartTime = minutesToISOString(newStartMinutes, targetDate)
      const newEndTime = minutesToISOString(newStartMinutes + duration, targetDate)

      updateAvailabilityBlock(blockId, {
        startTime: newStartTime,
        endTime: newEndTime,
      })

      toast({
        title: 'Disponibilité déplacée',
        description: `${format(new Date(newStartTime), 'HH:mm')} - ${format(new Date(newEndTime), 'HH:mm')}`,
      })
    },
    [availabilityBlocks, getTargetDate, updateAvailabilityBlock]
  )

  const handleAvailabilityResize = useCallback(
    (blockId: string, dayIndex: number, edge: 'top' | 'bottom', newMinutesAbs: number) => {
      const block = availabilityBlocks.find(b => b.id === blockId)
      if (!block) return

      const targetDate = getTargetDate(dayIndex)
      const currentStartMinutes = isoStringToMinutes(block.startTime)
      const currentEndMinutes = isoStringToMinutes(block.endTime)

      let newStartMinutes = currentStartMinutes
      let newEndMinutes = currentEndMinutes

      if (edge === 'top') {
        newStartMinutes = newMinutesAbs
        // Ensure minimum 30 minute duration
        if (newEndMinutes - newStartMinutes < 30) {
          newStartMinutes = newEndMinutes - 30
        }
      } else {
        newEndMinutes = newMinutesAbs
        // Ensure minimum 30 minute duration
        if (newEndMinutes - newStartMinutes < 30) {
          newEndMinutes = newStartMinutes + 30
        }
      }

      const newStartTime = minutesToISOString(newStartMinutes, targetDate)
      const newEndTime = minutesToISOString(newEndMinutes, targetDate)

      updateAvailabilityBlock(blockId, {
        startTime: newStartTime,
        endTime: newEndTime,
      })

      toast({
        title: 'Disponibilité modifiée',
        description: `${format(new Date(newStartTime), 'HH:mm')} - ${format(new Date(newEndTime), 'HH:mm')}`,
      })
    },
    [availabilityBlocks, getTargetDate, updateAvailabilityBlock]
  )

  const handleAppointmentMove = useCallback(
    (aptId: string, dayIndex: number, newStartMinutes: number) => {
      const apt = appointments.find(a => a.id === aptId)
      if (!apt) return

      const targetDate = getTargetDate(dayIndex)
      const newStartTime = minutesToISOString(newStartMinutes, targetDate)

      updateAppointment(aptId, {
        startTime: newStartTime,
      })

      toast({
        title: 'Rendez-vous déplacé',
        description: `Déplacé au ${format(new Date(newStartTime), 'dd/MM à HH:mm')}.`,
      })
    },
    [appointments, getTargetDate, updateAppointment]
  )

  const handleAppointmentResize = useCallback(
    (aptId: string, dayIndex: number, edge: 'top' | 'bottom', newMinutesAbs: number) => {
      const apt = appointments.find(a => a.id === aptId)
      if (!apt) return

      const targetDate = getTargetDate(dayIndex)
      const currentStartMinutes = isoStringToMinutes(apt.startTime)
      const currentEndMinutes = currentStartMinutes + apt.durationMinutes

      let newStartMinutes = currentStartMinutes
      let newEndMinutes = currentEndMinutes

      if (edge === 'top') {
        newStartMinutes = newMinutesAbs
        // Ensure minimum 15 minute, maximum 240 minute duration
        const duration = newEndMinutes - newStartMinutes
        if (duration < 15) {
          newStartMinutes = newEndMinutes - 15
        } else if (duration > 240) {
          newStartMinutes = newEndMinutes - 240
        }
      } else {
        newEndMinutes = newMinutesAbs
        // Ensure minimum 15 minute, maximum 240 minute duration
        const duration = newEndMinutes - newStartMinutes
        if (duration < 15) {
          newEndMinutes = newStartMinutes + 15
        } else if (duration > 240) {
          newEndMinutes = newStartMinutes + 240
        }
      }

      const newStartTime = minutesToISOString(newStartMinutes, targetDate)
      const newDuration = newEndMinutes - newStartMinutes

      updateAppointment(aptId, {
        startTime: newStartTime,
        durationMinutes: newDuration,
      })

      toast({
        title: 'Durée modifiée',
        description: `Nouvelle durée: ${newDuration} minutes.`,
      })
    },
    [appointments, getTargetDate, updateAppointment]
  )

  const handleServiceDrop = useCallback(
    (serviceId: string, dayIndex: number, startMinutes: number) => {
      const service = bookableServices.find(s => s.id === serviceId)
      if (!service || !selectedProfessionalId) return

      const targetDate = getTargetDate(dayIndex)
      const startTime = minutesToISOString(startMinutes, targetDate)

      // Create draft appointment
      const newAppointment: Appointment = {
        id: `new-${Date.now()}`,
        professionalId: selectedProfessionalId,
        clientIds: [],
        serviceId: service.id,
        startTime,
        durationMinutes: service.durationMinutes,
        status: 'draft',
        mode: 'video',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      // Open the appointment editor with the new appointment
      setSelectedAppointment(newAppointment)
      setSheetContent('appointment')
      setSheetOpen(true)

      toast({ title: 'Brouillon créé', description: 'Assignez un client pour confirmer.' })
    },
    [bookableServices, getTargetDate, selectedProfessionalId]
  )

  // =============================================================================
  // useCalendarDnd Hook Setup
  // =============================================================================

  const getAvailabilityBlockForDnd = useCallback(
    (id: string) => {
      const block = availabilityBlocks.find(b => b.id === id)
      if (!block) return null
      return {
        startMinutes: isoStringToMinutes(block.startTime),
        endMinutes: isoStringToMinutes(block.endTime),
      }
    },
    [availabilityBlocks]
  )

  const getAppointmentForDnd = useCallback(
    (id: string) => {
      const apt = appointments.find(a => a.id === id)
      if (!apt) return null
      return {
        startMinutes: isoStringToMinutes(apt.startTime),
        durationMinutes: apt.durationMinutes,
      }
    },
    [appointments]
  )

  const {
    dragState,
    isDragging,
    sensors,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
    registerDayColumn,
    preview,
  } = useCalendarDnd({
    callbacks: {
      onAvailabilityCreate: handleAvailabilityCreate,
      onAvailabilityMove: handleAvailabilityMove,
      onAvailabilityResize: handleAvailabilityResize,
      onAppointmentMove: handleAppointmentMove,
      onAppointmentResize: handleAppointmentResize,
      onServiceDrop: handleServiceDrop,
    },
    config: DEFAULT_CONFIG,
    getAvailabilityBlock: getAvailabilityBlockForDnd,
    getAppointment: getAppointmentForDnd,
  })



  // =============================================================================
  // Click Handlers
  // =============================================================================

  const handleSlotClick = useCallback((date: Date, time: string) => {
    // Don't open modal if we were just dragging
    if (isDragging) return

    if (calendarMode === 'availability') {
      // Create new availability block
      const startTime = new Date(`${format(date, 'yyyy-MM-dd')}T${time}:00`)
      const endTime = new Date(startTime)
      endTime.setMinutes(endTime.getMinutes() + 30) // Default 30 minute block

      const newBlock: AvailabilityBlock = {
        id: `new-${Date.now()}`,
        professionalId: selectedProfessionalId || '',
        type: 'available',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        isRecurring: false,
        visibleToClients: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setSelectedBlock(newBlock)
      setSheetContent('availability')
      setSheetOpen(true)
    } else {
      // In booking mode, open appointment editor
      if (!selectedProfessionalId) return

      const startTime = new Date(`${format(date, 'yyyy-MM-dd')}T${time}:00`)
      const defaultService = bookableServices[0]

      const newAppointment: Appointment = {
        id: `new-${Date.now()}`,
        professionalId: selectedProfessionalId,
        clientIds: [],
        serviceId: defaultService?.id || '',
        startTime: startTime.toISOString(),
        durationMinutes: defaultService?.durationMinutes || 50,
        status: 'draft',
        mode: 'video',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setSelectedAppointment(newAppointment)
      setSheetContent('appointment')
      setSheetOpen(true)
    }
  }, [bookableServices, calendarMode, selectedProfessionalId, isDragging])

  const handleAppointmentClick = useCallback((appointment: Appointment) => {
    if (isDragging) return
    setSelectedAppointment(appointment)
    setSheetContent('appointment')
    setSheetOpen(true)
  }, [isDragging])

  const handleAvailabilityBlockClick = useCallback((block: AvailabilityBlock) => {
    if (isDragging) return
    setSelectedBlock(block)
    setSheetContent('availability')
    setSheetOpen(true)
  }, [isDragging])

  const handleWeekChange = useCallback((newWeekStart: Date) => {
    setViewDate(newWeekStart)
  }, [])

  // Note: handleViewModeChange is available for future view mode selector
  const handleViewModeChange = useCallback((mode: CalendarViewMode) => {
    setViewMode(mode)
  }, [])
  // Expose for future use when view mode toggle is added
  void handleViewModeChange

  // Default block template for creating new availability
  const defaultBlock: AvailabilityBlock = useMemo(() => ({
    id: `new-${Date.now()}`,
    professionalId: selectedProfessionalId || '',
    type: 'available',
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    isRecurring: false,
    visibleToClients: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }), [selectedProfessionalId])

  // =============================================================================
  // Helpers for DragOverlay
  // =============================================================================

  const getAvailabilityBlockForOverlay = useCallback(
    (id: string) => availabilityBlocks.find(b => b.id === id) || null,
    [availabilityBlocks]
  )

  const getAppointmentForOverlay = useCallback(
    (id: string) => appointments.find(a => a.id === id) || null,
    [appointments]
  )

  const getServiceForOverlay = useCallback(
    (id: string) => bookableServices.find(s => s.id === id) || null,
    [bookableServices]
  )

  const getClientsForOverlay = useCallback(
    (ids: string[]) => ids.map(id => clients.find(c => c.id === id)),
    [clients]
  )

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Header with ModeToggle */}
      <div className="flex items-center justify-end px-6 py-3 border-b border-border bg-background">
        <div className="flex items-center gap-4">
          <ProfessionalSelector
            selectedId={selectedProfessionalId}
            onSelect={setSelectedProfessionalId}
            professionals={professionals}
          />
          {calendarMode === 'booking' && (
            <Button
              variant={showAvailabilityOverlay ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setShowAvailabilityOverlay(prev => !prev)}
            >
              {showAvailabilityOverlay ? 'Masquer disponibilités' : 'Afficher disponibilités'}
            </Button>
          )}
          <ModeToggle mode={calendarMode} onModeChange={setCalendarMode} />
        </div>
      </div>

      {/* Main content with sidebar - wrapped in DndContext */}
      <DndContext
        sensors={sensors}
        modifiers={[snapToTimeGrid]}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="flex-1 flex overflow-hidden">
          {/* Collapsible Sidebar with mode-specific content */}
          <CollapsibleSidebar>
            {calendarMode === 'availability' ? (
              <AvailabilitySidebar
                availabilityBlocks={professionalBlocks}
                weekStartDate={weekStartDate}
                professionalId={selectedProfessionalId}
                onCreateAvailability={(type) => {
                  const now = new Date()
                  const startTime = new Date(now)
                  startTime.setHours(9, 0, 0, 0)
                  const endTime = new Date(now)
                  endTime.setHours(17, 0, 0, 0)

                  setSelectedBlock({
                    ...defaultBlock,
                    type,
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                  })
                  setSheetContent('availability')
                  setSheetOpen(true)
                }}
                onBlockClick={(block) => {
                  setSelectedBlock(block)
                  setSheetContent('availability')
                  setSheetOpen(true)
                }}
              />
            ) : (
              <BookingSidebar
                professional={selectedProfessional}
                appointments={professionalAppointments}
                onAppointmentClick={(apt) => {
                  setSelectedAppointment(apt)
                  setSheetContent('appointment')
                  setSheetOpen(true)
                }}
                bookableServices={professionalBookableServices}
                clients={clients}
              />
            )}
          </CollapsibleSidebar>

          {/* Calendar area */}
          <div className="flex-1 flex flex-col p-4 overflow-hidden">
            {/* Week navigation (for week/day views) */}
            {viewMode !== 'list' && (
              <div className="mb-4">
                <WeekNavigation
                  weekStartDate={weekStartDate}
                  onWeekChange={handleWeekChange}
                />
              </div>
            )}

            {/* View content */}
            {viewMode === 'week' && (
              <CalendarGrid
                weekStartDate={weekStartDate}
                appointments={professionalAppointments}
                availabilityBlocks={professionalBlocks}
                calendarMode={calendarMode}
                onSlotClick={handleSlotClick}
                onAppointmentClick={handleAppointmentClick}
                onAvailabilityBlockClick={handleAvailabilityBlockClick}
                showAvailabilityOverlay={showAvailabilityOverlay}
                onDayColumnRegister={registerDayColumn}
                dragPreview={preview}
                activeDragId={dragState.activeId}
                isDraggingService={dragState.context === 'service-drop'}
                draggingServiceId={dragState.context === 'service-drop' ? dragState.activeId : null}
                bookableServices={bookableServices}
                clients={clients}
              />
            )}

            {viewMode === 'day' && (
              <DayView
                date={viewDate}
                appointments={professionalAppointments}
                onSlotClick={handleSlotClick}
                onAppointmentClick={handleAppointmentClick}
                bookableServices={bookableServices}
                clients={clients}
              />
            )}

            {viewMode === 'list' && (
              <ListView
                viewDate={viewDate}
                appointments={professionalAppointments}
                onAppointmentClick={handleAppointmentClick}
                bookableServices={bookableServices}
                clients={clients}
              />
            )}
          </div>
        </div>

        {/* Drag overlay */}
        <CalendarDragOverlay
          dragState={dragState}
          config={DEFAULT_CONFIG}
          getAvailabilityBlock={getAvailabilityBlockForOverlay}
          getAppointment={getAppointmentForOverlay}
          getService={getServiceForOverlay}
          getClients={getClientsForOverlay}
        />
      </DndContext>

      {/* DetailSheet for editing */}
      <DetailSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={sheetContent === 'availability' ? 'Disponibilité' : 'Rendez-vous'}
        hasUnsavedChanges={hasUnsavedChanges}
      >
        {sheetContent === 'availability' && selectedBlock && (
          <AvailabilityEditor
            block={selectedBlock}
            appointments={professionalAppointments}
            onSave={(data) => {
              if (selectedBlock.id.startsWith('new-')) {
                createAvailabilityBlock({
                  ...selectedBlock,
                  ...data,
                  professionalId: selectedProfessionalId!
                })
              } else {
                updateAvailabilityBlock(selectedBlock.id, data)
              }
              setSheetOpen(false)
              setHasUnsavedChanges(false)
              toast({
                title: selectedBlock.id.startsWith('new-') ? 'Disponibilité créée' : 'Disponibilité modifiée',
                description: 'Les modifications ont été enregistrées.',
              })
            }}
            onDelete={() => {
              deleteAvailabilityBlock(selectedBlock.id)
              setSheetOpen(false)
              setHasUnsavedChanges(false)
              toast({
                title: 'Disponibilité supprimée',
                description: 'La disponibilité a été supprimée.',
              })
            }}
            onCancel={() => setSheetOpen(false)}
            onDirtyChange={setHasUnsavedChanges}
          />
        )}
        {sheetContent === 'appointment' && selectedAppointment && (
          <AppointmentEditor
            appointment={selectedAppointment}
            onSave={(data) => {
              if (selectedAppointment.id.startsWith('new-')) {
                createAppointment({
                  ...selectedAppointment,
                  ...data,
                })
              } else {
                updateAppointment(selectedAppointment.id, data)
              }
              setSheetOpen(false)
              setHasUnsavedChanges(false)
              toast({
                title: selectedAppointment.id.startsWith('new-') ? 'Rendez-vous créé' : 'Rendez-vous modifié',
                description: 'Les modifications ont été enregistrées.',
              })
            }}
            onCancel={() => setSheetOpen(false)}
            onCancelAppointment={(info) => {
              cancelAppointment(selectedAppointment.id, info)
              setSheetOpen(false)
              toast({
                title: 'Rendez-vous annulé',
                description: 'Le rendez-vous a été annulé.',
              })
            }}
            onRestoreAppointment={() => {
              restoreAppointment(selectedAppointment.id)
              toast({
                title: 'Rendez-vous restauré',
                description: 'Le rendez-vous a été restauré.',
              })
            }}
            onDirtyChange={setHasUnsavedChanges}
            bookableServices={bookableServices}
            clients={clients}
            selectedProfessionalId={selectedProfessionalId}
          />
        )}
      </DetailSheet>
    </div>
  )
}

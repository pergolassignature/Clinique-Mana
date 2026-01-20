// src/pages/availability.tsx

import { useState, useCallback, useMemo } from 'react'
import { startOfWeek, addDays, format } from 'date-fns'
import { t } from '@/i18n'
import { toast } from '@/shared/hooks/use-toast'
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
  useCalendarDrag,

  // Types
  type Appointment,
  type AvailabilityBlock,
  type BookableService,
  type CalendarMode,
  type CalendarViewMode,
  type TimeRange,
} from '@/availability'
import { MOCK_PROFESSIONALS, MOCK_BOOKABLE_SERVICES } from '@/availability/mock'

const SLOT_HEIGHT = 40
const INTERVAL_MINUTES = 30
const START_HOUR = 6

export function AvailabilityPage() {
  // Professional selection
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string | null>('pro-1')

  // View state
  const [viewDate, setViewDate] = useState<Date>(() => new Date())
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week')

  // Mode state (v3)
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('booking')

  // Detail sheet state (v3)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetContent, setSheetContent] = useState<'availability' | 'appointment' | null>(null)
  const [selectedBlock, setSelectedBlock] = useState<AvailabilityBlock | null>(null)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Dragging service state (v3)
  const [draggingService, setDraggingService] = useState<BookableService | null>(null)

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
    return MOCK_PROFESSIONALS.find(p => p.id === selectedProfessionalId) || null
  }, [selectedProfessionalId])

  // Week start for navigation
  const weekStartDate = useMemo(() => {
    return startOfWeek(viewDate, { weekStartsOn: 1 })
  }, [viewDate])

  // Service drag handlers (v3)
  const handleServiceDragStart = useCallback((e: React.DragEvent, service: BookableService) => {
    e.dataTransfer.setData('application/json', JSON.stringify(service))
    setDraggingService(service)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  // Note: handleDrop is currently used by onDragOver context but actual drop handling
  // would require CalendarGrid to expose onDrop - keeping for future use
  const _handleDrop = useCallback((e: React.DragEvent, date: Date, time: string) => {
    e.preventDefault()
    if (!draggingService || !selectedProfessionalId) return

    const startTime = new Date(`${format(date, 'yyyy-MM-dd')}T${time}:00`)

    // Create draft appointment
    createAppointment({
      professionalId: selectedProfessionalId,
      clientIds: [],
      serviceId: draggingService.id,
      startTime: startTime.toISOString(),
      durationMinutes: draggingService.durationMinutes,
      status: 'draft',
    })

    setDraggingService(null)
    toast({ title: 'Brouillon cree', description: 'Assignez un client pour confirmer.' })
  }, [draggingService, selectedProfessionalId, createAppointment])

  // Expose handleDrop for future use - currently CalendarGrid doesn't have onDrop prop
  void _handleDrop

  // Drag interaction handlers
  const handleCreateDrag = useCallback(
    (dayIndex: number, timeRange: TimeRange) => {
      const targetDate = viewMode === 'day' ? viewDate : addDays(weekStartDate, dayIndex)
      const hours = Math.floor(timeRange.startMinutes / 60)
      const minutes = timeRange.startMinutes % 60
      const time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`

      if (calendarMode === 'availability') {
        // Create a new availability block
        const startTime = new Date(`${format(targetDate, 'yyyy-MM-dd')}T${time}:00`)
        const endHours = Math.floor(timeRange.endMinutes / 60)
        const endMinutes = timeRange.endMinutes % 60
        const endTime = new Date(`${format(targetDate, 'yyyy-MM-dd')}T${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}:00`)

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
        // In booking mode, open appointment editor with time pre-filled
        if (!selectedProfessionalId) return

        const startTime = new Date(`${format(targetDate, 'yyyy-MM-dd')}T${time}:00`)
        const defaultService = MOCK_BOOKABLE_SERVICES[0]

        const newAppointment: Appointment = {
          id: `new-${Date.now()}`,
          professionalId: selectedProfessionalId,
          clientIds: [],
          serviceId: defaultService?.id || '',
          startTime: startTime.toISOString(),
          durationMinutes: defaultService?.durationMinutes || 50,
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        setSelectedAppointment(newAppointment)
        setSheetContent('appointment')
        setSheetOpen(true)
      }
    },
    [viewMode, viewDate, weekStartDate, calendarMode, selectedProfessionalId]
  )

  const handleMoveDrag = useCallback(
    (appointmentId: string, newStartMinutes: number, dayIndex: number) => {
      const apt = appointments.find(a => a.id === appointmentId)
      if (!apt) return

      const targetDate = viewMode === 'day' ? viewDate : addDays(weekStartDate, dayIndex)
      const hours = Math.floor(newStartMinutes / 60)
      const minutes = newStartMinutes % 60

      const newStartTime = new Date(targetDate)
      newStartTime.setHours(hours, minutes, 0, 0)

      updateAppointment(apt.id, {
        startTime: newStartTime.toISOString(),
      })

      toast({
        title: 'Rendez-vous deplace',
        description: `Deplace au ${format(newStartTime, 'dd/MM a HH:mm')}.`,
      })
    },
    [appointments, updateAppointment, viewMode, viewDate, weekStartDate]
  )

  const handleResizeDrag = useCallback(
    (appointmentId: string, newDuration: number) => {
      const apt = appointments.find(a => a.id === appointmentId)
      if (!apt) return

      const finalDuration = Math.max(30, Math.min(newDuration, 240))

      updateAppointment(apt.id, {
        durationMinutes: finalDuration,
      })

      toast({
        title: 'Duree modifiee',
        description: `Nouvelle duree: ${finalDuration} minutes.`,
      })
    },
    [appointments, updateAppointment]
  )

  const {
    startCreateDrag,
    startMoveDrag,
    startResizeDrag,
    handlePointerMove,
    handlePointerUp,
    getCreatePreview,
    isDragging,
  } = useCalendarDrag({
    slotHeight: SLOT_HEIGHT,
    intervalMinutes: INTERVAL_MINUTES,
    startHour: START_HOUR,
    onCreateDrag: handleCreateDrag,
    onMoveDrag: handleMoveDrag,
    onResizeDrag: handleResizeDrag,
  })

  const createPreview = getCreatePreview()

  // Click handlers
  const handleSlotClick = useCallback((date: Date, time: string) => {
    if (calendarMode === 'availability') {
      // Create new availability block
      const startTime = new Date(`${format(date, 'yyyy-MM-dd')}T${time}:00`)
      const endTime = new Date(startTime)
      endTime.setHours(endTime.getHours() + 1) // Default 1 hour block

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
      const defaultService = MOCK_BOOKABLE_SERVICES[0]

      const newAppointment: Appointment = {
        id: `new-${Date.now()}`,
        professionalId: selectedProfessionalId,
        clientIds: [],
        serviceId: defaultService?.id || '',
        startTime: startTime.toISOString(),
        durationMinutes: defaultService?.durationMinutes || 50,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setSelectedAppointment(newAppointment)
      setSheetContent('appointment')
      setSheetOpen(true)
    }
  }, [calendarMode, selectedProfessionalId])

  const handleAppointmentClick = useCallback((appointment: Appointment) => {
    setSelectedAppointment(appointment)
    setSheetContent('appointment')
    setSheetOpen(true)
  }, [])

  const handleAvailabilityBlockClick = useCallback((block: AvailabilityBlock) => {
    setSelectedBlock(block)
    setSheetContent('availability')
    setSheetOpen(true)
  }, [])

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

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Header with ModeToggle */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t('pages.availability.title')}
          </h1>
          <p className="text-sm text-foreground-secondary mt-0.5">
            {calendarMode === 'availability'
              ? 'Gerez les disponibilites'
              : 'Planifiez les rendez-vous'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ProfessionalSelector
            selectedId={selectedProfessionalId}
            onSelect={setSelectedProfessionalId}
          />
          <ModeToggle mode={calendarMode} onModeChange={setCalendarMode} />
        </div>
      </div>

      {/* Main content with sidebar */}
      <div className="flex-1 flex overflow-hidden" onDragOver={handleDragOver}>
        {/* Collapsible Sidebar with mode-specific content */}
        <CollapsibleSidebar>
          {calendarMode === 'availability' ? (
            <AvailabilitySidebar
              availabilityBlocks={professionalBlocks}
              weekStartDate={weekStartDate}
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
              onServiceDragStart={handleServiceDragStart}
              onAppointmentClick={(apt) => {
                setSelectedAppointment(apt)
                setSheetContent('appointment')
                setSheetOpen(true)
              }}
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
              onCreateDragStart={startCreateDrag}
              onAppointmentDragStart={startMoveDrag}
              onAppointmentResizeStart={startResizeDrag}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              createPreview={createPreview}
              isDragging={isDragging}
            />
          )}

          {viewMode === 'day' && (
            <DayView
              date={viewDate}
              appointments={professionalAppointments}
              onSlotClick={handleSlotClick}
              onAppointmentClick={handleAppointmentClick}
              onCreateDragStart={startCreateDrag}
              onAppointmentDragStart={startMoveDrag}
              onAppointmentResizeStart={startResizeDrag}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              createPreview={createPreview}
              isDragging={isDragging}
            />
          )}

          {viewMode === 'list' && (
            <ListView
              viewDate={viewDate}
              appointments={professionalAppointments}
              onAppointmentClick={handleAppointmentClick}
            />
          )}
        </div>
      </div>

      {/* DetailSheet for editing */}
      <DetailSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={sheetContent === 'availability' ? 'Disponibilite' : 'Rendez-vous'}
        hasUnsavedChanges={hasUnsavedChanges}
      >
        {sheetContent === 'availability' && selectedBlock && (
          <AvailabilityEditor
            block={selectedBlock}
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
                title: selectedBlock.id.startsWith('new-') ? 'Disponibilite creee' : 'Disponibilite modifiee',
                description: 'Les modifications ont ete enregistrees.',
              })
            }}
            onDelete={() => {
              deleteAvailabilityBlock(selectedBlock.id)
              setSheetOpen(false)
              setHasUnsavedChanges(false)
              toast({
                title: 'Disponibilite supprimee',
                description: 'La disponibilite a ete supprimee.',
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
                title: selectedAppointment.id.startsWith('new-') ? 'Rendez-vous cree' : 'Rendez-vous modifie',
                description: 'Les modifications ont ete enregistrees.',
              })
            }}
            onCancel={() => setSheetOpen(false)}
            onCancelAppointment={() => {
              cancelAppointment(selectedAppointment.id)
              setSheetOpen(false)
              toast({
                title: 'Rendez-vous annule',
                description: 'Le rendez-vous a ete annule.',
              })
            }}
            onRestoreAppointment={() => {
              restoreAppointment(selectedAppointment.id)
              toast({
                title: 'Rendez-vous restaure',
                description: 'Le rendez-vous a ete restaure.',
              })
            }}
            onDirtyChange={setHasUnsavedChanges}
          />
        )}
      </DetailSheet>
    </div>
  )
}

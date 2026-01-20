// src/pages/availability.tsx

import { useState, useCallback, useMemo } from 'react'
import { startOfWeek, addDays, format } from 'date-fns'
import { Plus } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/hooks/use-toast'
import {
  useAppointments,
  useAppointmentsByProfessional,
  useCalendarDrag,
  CalendarGrid,
  CalendarSidebar,
  DayView,
  ListView,
  WeekNavigation,
  ProfessionalSelector,
  AppointmentDialog,
  AppointmentDetailDrawer,
  type Appointment,
  type AppointmentFormData,
  type CalendarViewMode,
  type TimeRange,
} from '@/availability'

interface SlotClickData {
  date: Date
  time: string
}

const SLOT_HEIGHT = 40
const INTERVAL_MINUTES = 30
const START_HOUR = 6

export function AvailabilityPage() {
  // Professional selection
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string | null>('pro-1')

  // View state
  const [viewDate, setViewDate] = useState<Date>(() => new Date())
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week')

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [slotClickData, setSlotClickData] = useState<SlotClickData | null>(null)

  // Appointment state
  const {
    appointments,
    createAppointment,
    updateAppointment,
    cancelAppointment,
    restoreAppointment,
  } = useAppointments()

  const professionalAppointments = useAppointmentsByProfessional(
    appointments,
    selectedProfessionalId
  )

  // Week start for navigation
  const weekStartDate = useMemo(() => {
    return startOfWeek(viewDate, { weekStartsOn: 1 })
  }, [viewDate])

  // Drag interaction handlers
  const handleCreateDrag = useCallback(
    (dayIndex: number, timeRange: TimeRange) => {
      const targetDate = viewMode === 'day' ? viewDate : addDays(weekStartDate, dayIndex)
      const hours = Math.floor(timeRange.startMinutes / 60)
      const minutes = timeRange.startMinutes % 60
      const time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`

      setSlotClickData({ date: targetDate, time })
      setSelectedAppointment(null)
      setCreateDialogOpen(true)
    },
    [viewMode, viewDate, weekStartDate]
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

      updateAppointment(appointmentId, {
        professionalId: apt.professionalId,
        clientId: apt.clientId,
        serviceId: apt.serviceId,
        startDate: format(newStartTime, 'yyyy-MM-dd'),
        startTime: format(newStartTime, 'HH:mm'),
        durationMinutes: apt.durationMinutes,
        notesInternal: apt.notesInternal,
      })

      toast({
        title: 'Rendez-vous déplacé',
        description: `Déplacé au ${format(newStartTime, 'dd/MM à HH:mm')}.`,
      })
    },
    [appointments, updateAppointment, viewMode, viewDate, weekStartDate]
  )

  const handleResizeDrag = useCallback(
    (appointmentId: string, newDuration: number) => {
      const apt = appointments.find(a => a.id === appointmentId)
      if (!apt) return

      const finalDuration = Math.max(30, Math.min(newDuration, 240))

      updateAppointment(appointmentId, {
        professionalId: apt.professionalId,
        clientId: apt.clientId,
        serviceId: apt.serviceId,
        startDate: format(new Date(apt.startTime), 'yyyy-MM-dd'),
        startTime: format(new Date(apt.startTime), 'HH:mm'),
        durationMinutes: finalDuration,
        notesInternal: apt.notesInternal,
      })

      toast({
        title: 'Durée modifiée',
        description: `Nouvelle durée: ${finalDuration} minutes.`,
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
    setSlotClickData({ date, time })
    setSelectedAppointment(null)
    setCreateDialogOpen(true)
  }, [])

  const handleAppointmentClick = useCallback((appointment: Appointment) => {
    setSelectedAppointment(appointment)
    setDetailDrawerOpen(true)
  }, [])

  const handleEditFromDetail = useCallback((appointment: Appointment) => {
    setSelectedAppointment(appointment)
    setDetailDrawerOpen(false)
    setEditDialogOpen(true)
  }, [])

  const handleCreate = useCallback(
    (data: AppointmentFormData) => {
      createAppointment(data)
      toast({
        title: 'Rendez-vous créé',
        description: `Le rendez-vous a été planifié pour le ${format(new Date(`${data.startDate}T${data.startTime}`), 'dd/MM/yyyy à HH:mm')}.`,
      })
      setCreateDialogOpen(false)
      setSlotClickData(null)
    },
    [createAppointment]
  )

  const handleEdit = useCallback(
    (data: AppointmentFormData) => {
      if (!selectedAppointment) return
      updateAppointment(selectedAppointment.id, data)
      toast({
        title: 'Rendez-vous modifié',
        description: 'Les modifications ont été enregistrées.',
      })
      setEditDialogOpen(false)
      setSelectedAppointment(null)
    },
    [selectedAppointment, updateAppointment]
  )

  const handleCancel = useCallback(
    (id: string) => {
      cancelAppointment(id)
      toast({
        title: 'Rendez-vous annulé',
        description: 'Le rendez-vous a été annulé.',
      })
    },
    [cancelAppointment]
  )

  const handleRestore = useCallback(
    (id: string) => {
      restoreAppointment(id)
      toast({
        title: 'Rendez-vous restauré',
        description: 'Le rendez-vous a été restauré.',
      })
    },
    [restoreAppointment]
  )

  const handleNewAppointment = useCallback(() => {
    setSlotClickData(null)
    setSelectedAppointment(null)
    setCreateDialogOpen(true)
  }, [])

  const handleWeekChange = useCallback((newWeekStart: Date) => {
    setViewDate(newWeekStart)
  }, [])

  const handleViewModeChange = useCallback((mode: CalendarViewMode) => {
    setViewMode(mode)
  }, [])

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t('pages.availability.title')}
          </h1>
          <p className="text-sm text-foreground-secondary mt-0.5">
            {t('pages.availability.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <ProfessionalSelector
            selectedId={selectedProfessionalId}
            onSelect={setSelectedProfessionalId}
          />
          <Button onClick={handleNewAppointment}>
            <Plus className="h-4 w-4" />
            {t('pages.availability.action')}
          </Button>
        </div>
      </div>

      {/* Main content with sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <CalendarSidebar
          appointments={professionalAppointments}
          viewDate={viewDate}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onAppointmentClick={handleAppointmentClick}
        />

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

      {/* Dialogs */}
      <AppointmentDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        mode="create"
        initialData={{
          professionalId: selectedProfessionalId ?? undefined,
          date: slotClickData?.date,
          time: slotClickData?.time,
        }}
        onSubmit={handleCreate}
      />

      <AppointmentDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        mode="edit"
        initialData={{
          appointment: selectedAppointment ?? undefined,
        }}
        onSubmit={handleEdit}
      />

      <AppointmentDetailDrawer
        open={detailDrawerOpen}
        onOpenChange={setDetailDrawerOpen}
        appointment={selectedAppointment}
        onEdit={handleEditFromDetail}
        onCancel={handleCancel}
        onRestore={handleRestore}
      />
    </div>
  )
}

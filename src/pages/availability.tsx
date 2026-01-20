// src/pages/availability.tsx

import { useState, useCallback } from 'react'
import { startOfWeek, format } from 'date-fns'
import { Plus, Calendar } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/components/empty-state'
import { toast } from '@/shared/hooks/use-toast'
import {
  useAppointments,
  useAppointmentsByProfessional,
  useAppointmentsForWeek,
  CalendarGrid,
  WeekNavigation,
  ProfessionalSelector,
  AppointmentDialog,
  AppointmentDetailDrawer,
  type Appointment,
  type AppointmentFormData,
} from '@/availability'

// Slot click data for prefilling create dialog
interface SlotClickData {
  date: Date
  time: string
}

export function AvailabilityPage() {
  // Professional selection state
  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string | null>('pro-1')

  // Week navigation state (start on Monday)
  const [weekStartDate, setWeekStartDate] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  )

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)

  // Selected appointment for detail/edit
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)

  // Slot click data for prefilling create dialog
  const [slotClickData, setSlotClickData] = useState<SlotClickData | null>(null)

  // Appointment state management
  const {
    appointments,
    createAppointment,
    updateAppointment,
    cancelAppointment,
    restoreAppointment,
  } = useAppointments()

  // Filter appointments by professional and week
  const professionalAppointments = useAppointmentsByProfessional(
    appointments,
    selectedProfessionalId
  )
  const weekAppointments = useAppointmentsForWeek(professionalAppointments, weekStartDate)

  // Handler: Click on empty slot to create appointment
  const handleSlotClick = useCallback((date: Date, time: string) => {
    setSlotClickData({ date, time })
    setSelectedAppointment(null)
    setCreateDialogOpen(true)
  }, [])

  // Handler: Click on appointment to view details
  const handleAppointmentClick = useCallback((appointment: Appointment) => {
    setSelectedAppointment(appointment)
    setDetailDrawerOpen(true)
  }, [])

  // Handler: Edit from detail drawer
  const handleEditFromDetail = useCallback((appointment: Appointment) => {
    setSelectedAppointment(appointment)
    setDetailDrawerOpen(false)
    setEditDialogOpen(true)
  }, [])

  // Handler: Create new appointment
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

  // Handler: Edit existing appointment
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

  // Handler: Cancel appointment
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

  // Handler: Restore cancelled appointment
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

  // Handler: New appointment button (no prefill)
  const handleNewAppointment = useCallback(() => {
    setSlotClickData(null)
    setSelectedAppointment(null)
    setCreateDialogOpen(true)
  }, [])

  return (
    <div className="space-y-6">
      {/* Header: Title + Action button */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t('pages.availability.title')}
          </h1>
          <p className="text-sm text-foreground-secondary mt-1">
            {t('pages.availability.subtitle')}
          </p>
        </div>
        <Button onClick={handleNewAppointment}>
          <Plus className="h-4 w-4" />
          {t('pages.availability.action')}
        </Button>
      </div>

      {/* Controls row: Professional selector + View label */}
      <div className="flex items-center gap-4">
        <ProfessionalSelector
          selectedId={selectedProfessionalId}
          onSelect={setSelectedProfessionalId}
        />
        <span className="text-sm text-foreground-secondary">
          {t('pages.availability.weekView')}
        </span>
      </div>

      {/* Week navigation */}
      <WeekNavigation weekStartDate={weekStartDate} onWeekChange={setWeekStartDate} />

      {/* Content: Calendar grid or empty state */}
      {selectedProfessionalId ? (
        <CalendarGrid
          weekStartDate={weekStartDate}
          appointments={weekAppointments}
          onSlotClick={handleSlotClick}
          onAppointmentClick={handleAppointmentClick}
        />
      ) : (
        <EmptyState
          icon={<Calendar className="h-8 w-8" />}
          title={t('pages.availability.selectProfessional')}
          description={t('pages.availability.empty.description')}
        />
      )}

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

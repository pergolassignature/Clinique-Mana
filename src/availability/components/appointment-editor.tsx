// src/availability/components/appointment-editor.tsx

import { useState, useEffect, useMemo } from 'react'
import { format } from 'date-fns'
import { User, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Textarea } from '@/shared/ui/textarea'
import { cn } from '@/shared/lib/utils'
import type { Appointment, AppointmentStatus, AppointmentMode } from '../types'
import { MOCK_BOOKABLE_SERVICES, MOCK_CLIENTS } from '../mock'

interface AppointmentEditorProps {
  appointment: Appointment | null
  onSave: (data: Partial<Appointment>) => void
  onCancel: () => void
  onCancelAppointment?: () => void
  onRestoreAppointment?: () => void
  onDirtyChange: (dirty: boolean) => void
}

const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: 'draft', label: 'Brouillon' },
  { value: 'confirmed', label: 'Confirme' },
]

const MODE_OPTIONS: { value: AppointmentMode; label: string }[] = [
  { value: 'in_person', label: 'En personne' },
  { value: 'video', label: 'Video' },
  { value: 'phone', label: 'Telephone' },
]

export function AppointmentEditor({
  appointment,
  onSave,
  onCancel,
  onCancelAppointment,
  onRestoreAppointment,
  onDirtyChange,
}: AppointmentEditorProps) {
  const isNew = !appointment?.id || appointment.id.startsWith('new-')
  const isCancelled = appointment?.status === 'cancelled'

  const service = useMemo(
    () => MOCK_BOOKABLE_SERVICES.find(s => s.id === appointment?.serviceId),
    [appointment?.serviceId]
  )

  const [serviceId] = useState(appointment?.serviceId || '')
  const [clientIds, setClientIds] = useState<string[]>(appointment?.clientIds || [])
  const [date, setDate] = useState(
    appointment ? format(new Date(appointment.startTime), 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd')
  )
  const [startTime, setStartTime] = useState(
    appointment ? format(new Date(appointment.startTime), 'HH:mm') : '09:00'
  )
  const [durationMinutes, setDurationMinutes] = useState(appointment?.durationMinutes || service?.durationMinutes || 50)
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status === 'cancelled' ? 'confirmed' : (appointment?.status || 'draft'))
  const [mode, setMode] = useState<AppointmentMode>(appointment?.mode || 'in_person')
  const [notes, setNotes] = useState(appointment?.notesInternal || '')

  const selectedService = useMemo(
    () => MOCK_BOOKABLE_SERVICES.find(s => s.id === serviceId),
    [serviceId]
  )

  // Track dirty state
  useEffect(() => {
    if (!appointment) {
      onDirtyChange(true)
      return
    }

    const isDirty =
      serviceId !== appointment.serviceId ||
      JSON.stringify(clientIds) !== JSON.stringify(appointment.clientIds) ||
      date !== format(new Date(appointment.startTime), 'yyyy-MM-dd') ||
      startTime !== format(new Date(appointment.startTime), 'HH:mm') ||
      durationMinutes !== appointment.durationMinutes ||
      (appointment.status !== 'cancelled' && status !== appointment.status) ||
      mode !== (appointment.mode || 'in_person') ||
      notes !== (appointment.notesInternal || '')

    onDirtyChange(isDirty)
  }, [serviceId, clientIds, date, startTime, durationMinutes, status, mode, notes, appointment, onDirtyChange])

  const handleClientToggle = (clientId: string) => {
    if (!selectedService) return

    if (clientIds.includes(clientId)) {
      setClientIds(clientIds.filter(id => id !== clientId))
    } else if (clientIds.length < selectedService.maxClients) {
      setClientIds([...clientIds, clientId])
    }
  }

  const handleSave = () => {
    const startDateTime = new Date(`${date}T${startTime}:00`)

    onSave({
      serviceId,
      clientIds,
      startTime: startDateTime.toISOString(),
      durationMinutes,
      status,
      mode,
      notesInternal: notes || undefined,
    })
  }

  const clientCountValid = selectedService
    ? clientIds.length >= selectedService.minClients && clientIds.length <= selectedService.maxClients
    : true

  return (
    <div className="space-y-6">
      {/* Cancelled banner */}
      {isCancelled && (
        <div className="p-3 rounded-lg bg-wine-50 border border-wine-200">
          <div className="text-sm font-medium text-wine-700">Rendez-vous annule</div>
          {appointment?.cancellationReason && (
            <div className="text-sm text-wine-600 mt-1">{appointment.cancellationReason}</div>
          )}
          {onRestoreAppointment && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRestoreAppointment}
              className="mt-2"
            >
              Restaurer
            </Button>
          )}
        </div>
      )}

      {/* Service display */}
      <div className="space-y-2">
        <Label>Service</Label>
        <div
          className="flex items-center gap-3 p-3 rounded-lg border border-border"
          style={{ backgroundColor: `${selectedService?.colorHex}15` }}
        >
          <div
            className="w-2 h-10 rounded-full"
            style={{ backgroundColor: selectedService?.colorHex }}
          />
          <div>
            <div className="font-medium">{selectedService?.nameFr || 'Service'}</div>
            <div className="text-sm text-foreground-muted">
              {selectedService?.durationMinutes} min · {selectedService?.clientType === 'individual' ? 'Individuel' : selectedService?.clientType === 'couple' ? 'Couple' : 'Famille'}
            </div>
          </div>
        </div>
      </div>

      {/* Client selection */}
      <div className="space-y-2">
        <Label>
          Client(s)
          {selectedService && (
            <span className="text-foreground-muted font-normal ml-2">
              ({clientIds.length}/{selectedService.maxClients} selectionne{clientIds.length > 1 ? 's' : ''})
            </span>
          )}
        </Label>
        <div className="space-y-1 max-h-48 overflow-y-auto border border-border rounded-lg p-2">
          {MOCK_CLIENTS.map(client => {
            const isSelected = clientIds.includes(client.id)
            const canSelect = isSelected || (selectedService && clientIds.length < selectedService.maxClients)

            return (
              <button
                key={client.id}
                onClick={() => handleClientToggle(client.id)}
                disabled={!canSelect && !isSelected}
                className={cn(
                  'w-full flex items-center gap-2 p-2 rounded-md transition-colors text-left',
                  isSelected
                    ? 'bg-sage-100 text-sage-800'
                    : canSelect
                    ? 'hover:bg-background-tertiary'
                    : 'opacity-50 cursor-not-allowed'
                )}
              >
                <User className="h-4 w-4" />
                <span className="text-sm">{client.firstName} {client.lastName}</span>
              </button>
            )
          })}
        </div>
        {!clientCountValid && selectedService && (
          <p className="text-xs text-wine-600">
            {selectedService.clientType === 'couple'
              ? 'Selectionnez 2 clients pour une consultation couple'
              : `Selectionnez entre ${selectedService.minClients} et ${selectedService.maxClients} clients`}
          </p>
        )}
      </div>

      {/* Date & Time */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={isCancelled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="startTime">Heure</Label>
          <Input
            id="startTime"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            disabled={isCancelled}
          />
        </div>
      </div>

      {/* Duration */}
      <div className="space-y-2">
        <Label htmlFor="duration">Duree (minutes)</Label>
        <Input
          id="duration"
          type="number"
          min={15}
          max={240}
          step={5}
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 50)}
          disabled={isCancelled}
        />
      </div>

      {/* Status & Mode */}
      {!isCancelled && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Statut</Label>
            <div className="flex gap-2">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setStatus(opt.value)}
                  className={cn(
                    'flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-all',
                    status === opt.value
                      ? 'border-sage-400 bg-sage-50 text-sage-700'
                      : 'border-border hover:border-sage-300'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Modalite</Label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as AppointmentMode)}
              className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm"
            >
              {MODE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">Notes internes</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes visibles uniquement par l'equipe..."
          rows={3}
          disabled={isCancelled}
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4 border-t border-border">
        {!isCancelled && (
          <>
            <Button
              onClick={handleSave}
              className="flex-1"
              disabled={!clientCountValid && status === 'confirmed'}
            >
              {isNew ? 'Creer' : 'Enregistrer'}
            </Button>
            {!isNew && onCancelAppointment && (
              <Button variant="outline" onClick={onCancelAppointment} className="text-wine-600">
                <Trash2 className="h-4 w-4 mr-1" />
                Annuler RDV
              </Button>
            )}
          </>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Fermer
        </Button>
      </div>
    </div>
  )
}

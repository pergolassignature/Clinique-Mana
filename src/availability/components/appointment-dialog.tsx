// src/availability/components/appointment-dialog.tsx

import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { MOCK_PROFESSIONALS, MOCK_CLIENTS, MOCK_SERVICES } from '../mock'
import type { Appointment, AppointmentFormData } from '../types'

interface AppointmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  initialData?: {
    professionalId?: string
    date?: Date
    time?: string
    appointment?: Appointment
  }
  onSubmit: (data: AppointmentFormData) => void
}

interface FormErrors {
  professionalId?: string
  clientIds?: string
  serviceId?: string
  startDate?: string
  startTime?: string
}

// Generate time options from 06:00 to 21:30 in 30-min intervals
function generateTimeOptions(): string[] {
  const times: string[] = []
  for (let hour = 6; hour <= 21; hour++) {
    times.push(`${hour.toString().padStart(2, '0')}:00`)
    if (hour < 21 || (hour === 21 && times[times.length - 1] !== '21:30')) {
      times.push(`${hour.toString().padStart(2, '0')}:30`)
    }
  }
  return times
}

const TIME_OPTIONS = generateTimeOptions()

// Duration options in minutes
const DURATION_OPTIONS = [15, 30, 45, 50, 60, 75, 90, 120]

export function AppointmentDialog({
  open,
  onOpenChange,
  mode,
  initialData,
  onSubmit,
}: AppointmentDialogProps) {
  // Form state
  const [professionalId, setProfessionalId] = useState('')
  const [clientIds, setClientIds] = useState<string[]>([])
  const [serviceId, setServiceId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(50)
  const [notesInternal, setNotesInternal] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setErrors({})

      if (mode === 'edit' && initialData?.appointment) {
        const apt = initialData.appointment
        const aptDate = new Date(apt.startTime)

        setProfessionalId(apt.professionalId)
        setClientIds(apt.clientIds)
        setServiceId(apt.serviceId)
        setStartDate(format(aptDate, 'yyyy-MM-dd'))
        setStartTime(format(aptDate, 'HH:mm'))
        setDurationMinutes(apt.durationMinutes)
        setNotesInternal(apt.notesInternal || '')
      } else {
        // Create mode - prefill from initialData
        setProfessionalId(initialData?.professionalId || '')
        setClientIds([])
        setServiceId('')
        setStartDate(initialData?.date ? format(initialData.date, 'yyyy-MM-dd') : '')
        setStartTime(initialData?.time || '')
        setDurationMinutes(50) // Default duration
        setNotesInternal('')
      }
    }
  }, [open, mode, initialData])

  // Update duration when service changes
  const handleServiceChange = (newServiceId: string) => {
    setServiceId(newServiceId)
    const service = MOCK_SERVICES.find((s) => s.id === newServiceId)
    if (service) {
      setDurationMinutes(service.durationMinutes)
    }
  }

  // Validate form
  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    if (!professionalId) {
      newErrors.professionalId = 'Veuillez sélectionner un professionnel'
    }
    if (clientIds.length === 0) {
      newErrors.clientIds = 'Veuillez sélectionner un client'
    }
    if (!serviceId) {
      newErrors.serviceId = 'Veuillez sélectionner un service'
    }
    if (!startDate) {
      newErrors.startDate = 'Veuillez sélectionner une date'
    }
    if (!startTime) {
      newErrors.startTime = 'Veuillez sélectionner une heure'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!validate()) {
      return
    }

    const formData: AppointmentFormData = {
      professionalId,
      clientIds,
      serviceId,
      startDate,
      startTime,
      durationMinutes,
      notesInternal: notesInternal.trim() || undefined,
    }

    onSubmit(formData)
    onOpenChange(false)
  }

  const dialogTitle = mode === 'create' ? 'Nouveau rendez-vous' : 'Modifier le rendez-vous'
  const dialogDescription =
    mode === 'create'
      ? 'Planifier un nouveau rendez-vous avec un client'
      : 'Modifier les informations du rendez-vous'
  const submitLabel = mode === 'create' ? 'Créer' : 'Enregistrer'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Professional */}
          <div className="space-y-1.5">
            <label
              htmlFor="professional"
              className="text-sm font-medium text-foreground"
            >
              Professionnel <span className="text-wine-500">*</span>
            </label>
            <Select
              id="professional"
              value={professionalId}
              onChange={(e) => setProfessionalId(e.target.value)}
              placeholder="Sélectionner un professionnel"
            >
              {MOCK_PROFESSIONALS.map((pro) => (
                <option key={pro.id} value={pro.id}>
                  {pro.displayName}
                </option>
              ))}
            </Select>
            {errors.professionalId && (
              <p className="text-xs text-wine-500">{errors.professionalId}</p>
            )}
          </div>

          {/* Client */}
          <div className="space-y-1.5">
            <label htmlFor="client" className="text-sm font-medium text-foreground">
              Client <span className="text-wine-500">*</span>
            </label>
            <Select
              id="client"
              value={clientIds[0] || ''}
              onChange={(e) => setClientIds(e.target.value ? [e.target.value] : [])}
              placeholder="Sélectionner un client"
            >
              {MOCK_CLIENTS.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.firstName} {client.lastName}
                </option>
              ))}
            </Select>
            {errors.clientIds && (
              <p className="text-xs text-wine-500">{errors.clientIds}</p>
            )}
          </div>

          {/* Service */}
          <div className="space-y-1.5">
            <label htmlFor="service" className="text-sm font-medium text-foreground">
              Service <span className="text-wine-500">*</span>
            </label>
            <Select
              id="service"
              value={serviceId}
              onChange={(e) => handleServiceChange(e.target.value)}
              placeholder="Sélectionner un service"
            >
              {MOCK_SERVICES.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.nameFr} ({service.durationMinutes} min)
                </option>
              ))}
            </Select>
            {errors.serviceId && (
              <p className="text-xs text-wine-500">{errors.serviceId}</p>
            )}
          </div>

          {/* Date and Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="date" className="text-sm font-medium text-foreground">
                Date <span className="text-wine-500">*</span>
              </label>
              <Input
                id="date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              {errors.startDate && (
                <p className="text-xs text-wine-500">{errors.startDate}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="time" className="text-sm font-medium text-foreground">
                Heure <span className="text-wine-500">*</span>
              </label>
              <Select
                id="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                placeholder="Sélectionner"
              >
                {TIME_OPTIONS.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </Select>
              {errors.startTime && (
                <p className="text-xs text-wine-500">{errors.startTime}</p>
              )}
            </div>
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <label htmlFor="duration" className="text-sm font-medium text-foreground">
              Durée (minutes)
            </label>
            <Select
              id="duration"
              value={durationMinutes.toString()}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
            >
              {DURATION_OPTIONS.map((duration) => (
                <option key={duration} value={duration}>
                  {duration} min
                </option>
              ))}
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label htmlFor="notes" className="text-sm font-medium text-foreground">
              Notes internes
            </label>
            <Textarea
              id="notes"
              value={notesInternal}
              onChange={(e) => setNotesInternal(e.target.value)}
              placeholder="Notes visibles uniquement par le personnel..."
              className="min-h-[80px]"
            />
          </div>

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Annuler
            </Button>
            <Button type="submit">{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// src/availability/components/appointment-detail-drawer.tsx

import { format, addMinutes } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  Calendar,
  Clock,
  User,
  FileText,
  Edit2,
  XCircle,
  RotateCcw,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'
import type { Appointment, Professional, BookableService, Client } from '../types'

interface AppointmentDetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: Appointment | null
  onEdit: (appointment: Appointment) => void
  onCancel: (id: string) => void
  onRestore: (id: string) => void
  /** Real data from database */
  professionals: Professional[]
  bookableServices: BookableService[]
  clients: Client[]
}

export function AppointmentDetailDrawer({
  open,
  onOpenChange,
  appointment,
  onEdit,
  onCancel,
  onRestore,
  professionals,
  bookableServices,
  clients,
}: AppointmentDetailDrawerProps) {
  if (!appointment) {
    return null
  }

  // Lookup related data
  const professional = professionals.find(
    (p) => p.id === appointment.professionalId
  )
  const client = clients.find((c) => c.id === appointment.clientIds[0])
  const service = bookableServices.find((s) => s.id === appointment.serviceId)

  // Calculate times
  const startDate = new Date(appointment.startTime)
  const endDate = addMinutes(startDate, appointment.durationMinutes)

  // Format date in French
  const formattedDate = format(startDate, "EEEE d MMMM yyyy", { locale: fr })
  const formattedTimeRange = `${format(startDate, 'HH:mm')} - ${format(endDate, 'HH:mm')}`

  const isCancelled = appointment.status === 'cancelled'

  // Handle action clicks
  const handleEdit = () => {
    onEdit(appointment)
    onOpenChange(false)
  }

  const handleCancel = () => {
    onCancel(appointment.id)
    onOpenChange(false)
  }

  const handleRestore = () => {
    onRestore(appointment.id)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle
            className={cn(isCancelled && 'line-through text-foreground-secondary')}
          >
            Rendez-vous
          </DialogTitle>
          <DialogDescription>
            {isCancelled ? 'Ce rendez-vous a été annulé' : 'Détails du rendez-vous'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Service with color indicator */}
          <div className="flex items-start gap-3">
            <div
              className="mt-0.5 h-4 w-4 shrink-0 rounded-full"
              style={{ backgroundColor: service?.colorHex || '#94a3b8' }}
            />
            <div>
              <p
                className={cn(
                  'font-medium text-foreground',
                  isCancelled && 'line-through text-foreground-secondary'
                )}
              >
                {service?.nameFr || 'Service inconnu'}
              </p>
              <p className="text-sm text-foreground-secondary">
                {appointment.durationMinutes} minutes
              </p>
            </div>
          </div>

          {/* Client info */}
          <div className="flex items-start gap-3">
            <User className="mt-0.5 h-4 w-4 shrink-0 text-foreground-secondary" />
            <div>
              <p
                className={cn(
                  'font-medium text-foreground',
                  isCancelled && 'line-through text-foreground-secondary'
                )}
              >
                {client ? `${client.firstName} ${client.lastName}` : 'Client inconnu'}
              </p>
              {client?.email && (
                <p className="text-sm text-foreground-secondary">{client.email}</p>
              )}
              {client?.phone && (
                <p className="text-sm text-foreground-secondary">{client.phone}</p>
              )}
            </div>
          </div>

          {/* Date/time */}
          <div className="flex items-start gap-3">
            <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-foreground-secondary" />
            <div>
              <p
                className={cn(
                  'font-medium text-foreground capitalize',
                  isCancelled && 'line-through text-foreground-secondary'
                )}
              >
                {formattedDate}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-foreground-secondary" />
            <p
              className={cn(
                'font-medium text-foreground',
                isCancelled && 'line-through text-foreground-secondary'
              )}
            >
              {formattedTimeRange}
            </p>
          </div>

          {/* Professional */}
          <div className="flex items-start gap-3">
            <User className="mt-0.5 h-4 w-4 shrink-0 text-foreground-secondary" />
            <p
              className={cn(
                'text-foreground',
                isCancelled && 'line-through text-foreground-secondary'
              )}
            >
              {professional?.displayName || 'Professionnel inconnu'}
            </p>
          </div>

          {/* Internal notes */}
          {appointment.notesInternal && (
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-foreground-secondary" />
              <div>
                <p className="text-sm font-medium text-foreground-secondary">
                  Notes internes
                </p>
                <p className="text-sm text-foreground">{appointment.notesInternal}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-4">
          {isCancelled ? (
            <Button onClick={handleRestore} className="w-full sm:w-auto">
              <RotateCcw className="h-4 w-4" />
              Restaurer
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleEdit}
                className="w-full sm:w-auto"
              >
                <Edit2 className="h-4 w-4" />
                Modifier
              </Button>
              <Button
                variant="destructive"
                onClick={handleCancel}
                className="w-full sm:w-auto"
              >
                <XCircle className="h-4 w-4" />
                Annuler
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

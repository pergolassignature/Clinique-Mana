import { useNavigate } from '@tanstack/react-router'
import { Calendar, DollarSign } from 'lucide-react'
import { t } from '@/i18n'
import {
  formatClinicDateShort,
  formatClinicTime,
} from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/shared/ui/accordion'
import { Badge } from '@/shared/ui/badge'
import { Skeleton } from '@/shared/ui/skeleton'
import { useClientAppointments, type ClientAppointmentInfo } from '@/availability/hooks'
import type { ClientWithRelations } from '../../types'

interface VisitsSectionProps {
  client: ClientWithRelations
}

type VisitStatus = 'upcoming' | 'completed' | 'cancelled'

/**
 * Check if an appointment has already passed (start time is in the past).
 * Compares full timestamps (date + time) for accurate determination.
 */
function isAppointmentPast(aptStartTime: string): boolean {
  const aptTime = new Date(aptStartTime).getTime()
  const now = Date.now()
  return aptTime < now
}

/**
 * Check if an appointment is still upcoming (start time is now or in the future).
 */
function isAppointmentUpcoming(aptStartTime: string): boolean {
  const aptTime = new Date(aptStartTime).getTime()
  const now = Date.now()
  return aptTime >= now
}

function mapAppointmentStatus(apt: ClientAppointmentInfo): VisitStatus {
  if (apt.status === 'cancelled') return 'cancelled'
  if (apt.status === 'completed') return 'completed'
  // For created/confirmed, check if it's in the past or future
  // Use clinic timezone date strings for consistent comparison
  if (isAppointmentPast(apt.startTime)) return 'completed'
  return 'upcoming'
}

export function VisitsSection({ client }: VisitsSectionProps) {
  const navigate = useNavigate()

  // Fetch appointments from database using client UUID
  const { data: appointments = [], isLoading } = useClientAppointments(client.id)

  const formatDate = (date: string) => {
    return formatClinicDateShort(date)
  }

  const formatTime = (date: string) => {
    return formatClinicTime(date)
  }

  const getStatusBadge = (status: VisitStatus) => {
    switch (status) {
      case 'upcoming':
        return <Badge className="bg-sage-100 text-sage-700 text-xs">À venir</Badge>
      case 'completed':
        return <Badge className="bg-background-tertiary text-foreground-secondary text-xs">Complété</Badge>
      case 'cancelled':
        return <Badge className="bg-wine-100/50 text-wine-600 text-xs">Annulé</Badge>
    }
  }

  const getPaymentBadge = (paymentStatus: ClientAppointmentInfo['paymentStatus']) => {
    switch (paymentStatus) {
      case 'paid':
        return <Badge className="bg-sage-100 text-sage-700 text-xs">Payé</Badge>
      case 'partial':
        return <Badge className="bg-amber-100 text-amber-700 text-xs">Partiel</Badge>
      case 'unpaid':
        return <Badge className="bg-wine-100/50 text-wine-600 text-xs">Non payé</Badge>
      case 'no_invoice':
        return null // No badge if no invoice exists
    }
  }

  const formatAmount = (amount: number) => {
    return `${amount.toFixed(2).replace('.', ',')} $`
  }

  // Navigate to availability page with appointment selected
  const handleAppointmentClick = (apt: ClientAppointmentInfo) => {
    navigate({
      to: '/disponibilites',
      search: { appointmentId: apt.id },
    })
  }

  // Separate upcoming and past appointments
  // Compare full timestamps (date + time) for accurate determination
  const upcomingAppointments = appointments.filter(apt => {
    return isAppointmentUpcoming(apt.startTime) && apt.status !== 'cancelled' && apt.status !== 'completed'
  })

  const pastAppointments = appointments.filter(apt => {
    return isAppointmentPast(apt.startTime) || apt.status === 'cancelled' || apt.status === 'completed'
  })

  return (
    <AccordionItem value="visits" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-sage-500" />
          <span>{t('clients.drawer.sections.visits')}</span>
          {appointments.length > 0 && (
            <Badge variant="secondary" className="ml-2 text-xs">
              {appointments.length}
            </Badge>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-4">
          {/* Balance summary */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-background-secondary">
            <div className="flex items-center gap-2 text-sm">
              <DollarSign className="h-4 w-4 text-foreground-secondary" />
              <span className="text-foreground-secondary">
                {t('clients.drawer.visits.balance')}
              </span>
            </div>
            <span className="font-semibold text-foreground">
              {formatAmount((client.balanceCents || 0) / 100)}
            </span>
          </div>

          {/* Loading state */}
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : appointments.length > 0 ? (
            <div className="space-y-4">
              {/* Upcoming appointments */}
              {upcomingAppointments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-foreground-secondary">
                    Rendez-vous à venir
                  </h4>
                  <ul className="space-y-2">
                    {upcomingAppointments.slice(0, 3).map(apt => (
                      <li
                        key={apt.id}
                        className="p-3 rounded-lg border border-sage-200 bg-sage-50/50 cursor-pointer hover:bg-sage-100/50 transition-colors"
                        onClick={() => handleAppointmentClick(apt)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {apt.serviceName}
                              </span>
                              {getStatusBadge(mapAppointmentStatus(apt))}
                            </div>
                            <p className="text-xs text-foreground-secondary">
                              {formatDate(apt.startTime)} à {formatTime(apt.startTime)} • {apt.professionalName}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Past appointments / history */}
              {pastAppointments.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-foreground-secondary">
                    {t('clients.drawer.visits.title')}
                  </h4>
                  <ul className="space-y-2">
                    {pastAppointments.slice(0, 5).map(apt => {
                      const status = mapAppointmentStatus(apt)
                      return (
                        <li
                          key={apt.id}
                          className={cn(
                            'p-3 rounded-lg border border-border cursor-pointer hover:bg-background-secondary/50 transition-colors',
                            status === 'cancelled' && 'opacity-60'
                          )}
                          onClick={() => handleAppointmentClick(apt)}
                        >
                          <div className="flex items-start justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground">
                                  {apt.serviceName}
                                </span>
                                {getStatusBadge(status)}
                                {status === 'completed' && getPaymentBadge(apt.paymentStatus)}
                              </div>
                              <p className="text-xs text-foreground-secondary">
                                {formatDate(apt.startTime)} à {formatTime(apt.startTime)} • {apt.professionalName}
                              </p>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  {pastAppointments.length > 5 && (
                    <button
                      className="text-sm text-sage-600 hover:text-sage-700 hover:underline"
                      disabled
                    >
                      {t('clients.drawer.visits.viewAll')} ({pastAppointments.length})
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-foreground-muted italic py-2">
              {t('clients.drawer.visits.noVisits')}
            </p>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

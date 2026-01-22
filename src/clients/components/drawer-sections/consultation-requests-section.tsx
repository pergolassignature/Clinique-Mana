import { FileText, AlertCircle, Clock, CheckCircle2, Users, User } from 'lucide-react'
import { t } from '@/i18n'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/shared/ui/accordion'
import { Badge } from '@/shared/ui/badge'
import { useClientConsultationRequests } from '../../hooks'
import type { ClientWithRelations } from '../../types'
import type { DemandeStatus, DemandType, UrgencyLevel, ParticipantRole } from '@/demandes/types'

interface ConsultationRequestsSectionProps {
  client: ClientWithRelations
  onViewDemande?: (demandeId: string) => void
}

interface ConsultationRequest {
  id: string // UUID
  demandeId: string // DEM-2026-0009
  status: DemandeStatus
  demandType: DemandType | null
  urgency: UrgencyLevel | null
  role: ParticipantRole
  participantCount: number
  assignedProfessionalName: string | null
  assignedProfessionalTitle: string | null
  createdAt: string
}

export function ConsultationRequestsSection({ client, onViewDemande }: ConsultationRequestsSectionProps) {
  const { data: consultationRequests = [], isLoading } = useClientConsultationRequests(client.id)

  const formatDate = (date: string) => {
    return formatClinicDateShort(date)
  }

  const getStatusIcon = (status: DemandeStatus) => {
    switch (status) {
      case 'toAnalyze':
        return <Clock className="h-4 w-4 text-honey-500" />
      case 'assigned':
        return <CheckCircle2 className="h-4 w-4 text-sage-500" />
      case 'closed':
        return <CheckCircle2 className="h-4 w-4 text-foreground-muted" />
    }
  }

  const getStatusBadge = (status: DemandeStatus) => {
    switch (status) {
      case 'toAnalyze':
        return <Badge className="bg-honey-100 text-honey-700 text-xs">{t('demandes.list.status.toAnalyze')}</Badge>
      case 'assigned':
        return <Badge className="bg-sage-100 text-sage-700 text-xs">{t('demandes.list.status.assigned')}</Badge>
      case 'closed':
        return <Badge className="bg-gray-100 text-gray-700 text-xs">{t('demandes.list.status.closed')}</Badge>
    }
  }

  const getUrgencyBadge = (urgency: UrgencyLevel | null) => {
    if (!urgency) return null

    switch (urgency) {
      case 'high':
        return <Badge className="bg-wine-100 text-wine-700 text-xs">{t('demandes.list.urgency.high')}</Badge>
      case 'moderate':
        return <Badge className="bg-honey-100 text-honey-700 text-xs">{t('demandes.list.urgency.moderate')}</Badge>
      case 'low':
        return <Badge className="bg-blue-100 text-blue-700 text-xs">{t('demandes.list.urgency.low')}</Badge>
    }
  }

  const getDemandTypeIcon = (type: DemandType | null) => {
    if (type === 'couple' || type === 'family' || type === 'group') {
      return <Users className="h-3 w-3" />
    }
    return <User className="h-3 w-3" />
  }

  const getDemandTypeLabel = (type: DemandType | null) => {
    if (!type) return t('demandes.list.type.individual')
    return t(`demandes.list.type.${type}`)
  }

  const getRoleLabel = (role: ParticipantRole) => {
    return t(`clients.drawer.consultationRequests.role.${role}`)
  }

  // Check if any request is pending analysis
  const hasPendingRequests = consultationRequests.some((cr) => cr.status === 'toAnalyze')

  return (
    <AccordionItem value="consultation-requests" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-sage-500" />
          <span>{t('clients.drawer.sections.consultationRequests')}</span>
          {hasPendingRequests && (
            <AlertCircle className="h-4 w-4 text-honey-500 ml-1" />
          )}
          {consultationRequests.length > 0 && (
            <Badge variant="secondary" className="ml-2 text-xs">
              {consultationRequests.length}
            </Badge>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-4">
          {/* Loading state */}
          {isLoading && (
            <p className="text-sm text-foreground-muted italic py-2">
              Chargement...
            </p>
          )}

          {/* Info banner if pending requests */}
          {!isLoading && hasPendingRequests && (
            <div className="p-3 rounded-lg bg-honey-50 border border-honey-200">
              <div className="flex items-start gap-2">
                <Clock className="h-4 w-4 text-honey-500 mt-0.5" />
                <p className="text-sm text-honey-800">
                  {t('clients.drawer.consultationRequests.pendingInfo')}
                </p>
              </div>
            </div>
          )}

          {/* Consultation requests list */}
          {!isLoading && consultationRequests.length > 0 ? (
            <ul className="space-y-3">
              {consultationRequests.map((request) => (
                <li
                  key={request.id}
                  className={cn(
                    'p-3 rounded-lg border cursor-pointer transition-colors hover:bg-background-secondary',
                    request.status === 'toAnalyze' && 'border-honey-200 bg-honey-50/30',
                    request.status === 'assigned' && 'border-sage-200 bg-sage-50/30',
                    request.status === 'closed' && 'border-border bg-background'
                  )}
                  onClick={() => onViewDemande?.(request.demandeId)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-start gap-2 flex-1">
                      {getStatusIcon(request.status)}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-foreground">
                            {request.demandeId}
                          </p>
                          <div className="flex items-center gap-1 text-xs text-foreground-muted">
                            {getDemandTypeIcon(request.demandType)}
                            <span>{getDemandTypeLabel(request.demandType)}</span>
                          </div>
                          {getUrgencyBadge(request.urgency)}
                        </div>

                        <p className="text-xs text-foreground-secondary mt-1">
                          {getRoleLabel(request.role)}
                          {request.participantCount > 1 && (
                            <span className="text-foreground-muted">
                              {' '}• {request.participantCount} {t('clients.drawer.consultationRequests.participants')}
                            </span>
                          )}
                        </p>

                        {request.assignedProfessionalName && (
                          <p className="text-xs text-foreground-muted mt-1">
                            {request.assignedProfessionalName}
                            {request.assignedProfessionalTitle && `, ${request.assignedProfessionalTitle}`}
                          </p>
                        )}
                      </div>
                    </div>
                    {getStatusBadge(request.status)}
                  </div>

                  <div className="text-xs text-foreground-muted">
                    {t('clients.drawer.consultationRequests.createdOn')} {formatDate(request.createdAt)}
                  </div>
                </li>
              ))}
            </ul>
          ) : !isLoading ? (
            <p className="text-sm text-foreground-muted italic py-2">
              {t('clients.drawer.consultationRequests.noRequests')}
            </p>
          ) : null}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

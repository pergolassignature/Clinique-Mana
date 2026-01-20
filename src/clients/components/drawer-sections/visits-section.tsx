import { Calendar, DollarSign } from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/shared/ui/accordion'
import { Badge } from '@/shared/ui/badge'
import type { ClientWithRelations, ClientVisit } from '../../types'

interface VisitsSectionProps {
  client: ClientWithRelations
}

export function VisitsSection({ client }: VisitsSectionProps) {
  const visits = client.visits || []

  const formatDate = (date: string) => {
    return format(new Date(date), 'dd MMM yyyy', { locale: fr })
  }

  const formatTime = (date: string) => {
    return format(new Date(date), 'HH:mm', { locale: fr })
  }

  const getStatusBadge = (status: ClientVisit['status']) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-sage-100 text-sage-700 text-xs">Complété</Badge>
      case 'cancelled':
        return <Badge className="bg-background-tertiary text-foreground-secondary text-xs">Annulé</Badge>
      case 'no-show':
        return <Badge className="bg-wine-100 text-wine-700 text-xs">Absent</Badge>
    }
  }

  const formatAmount = (amount: number) => {
    return `${amount.toFixed(2).replace('.', ',')} $`
  }

  return (
    <AccordionItem value="visits" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-sage-500" />
          <span>{t('clients.drawer.sections.visits')}</span>
          {visits.length > 0 && (
            <Badge variant="secondary" className="ml-2 text-xs">
              {visits.length}
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
              {formatAmount(client.balance || 0)}
            </span>
          </div>

          {/* Visits list */}
          {visits.length > 0 ? (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-foreground-secondary">
                {t('clients.drawer.visits.title')}
              </h4>
              <ul className="space-y-2">
                {visits.slice(0, 5).map(visit => (
                  <li
                    key={visit.id}
                    className={cn(
                      'p-3 rounded-lg border border-border',
                      visit.status === 'cancelled' && 'opacity-60'
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {visit.serviceName}
                          </span>
                          {getStatusBadge(visit.status)}
                        </div>
                        <p className="text-xs text-foreground-secondary">
                          {formatDate(visit.date)} à {formatTime(visit.date)} • {visit.professionalName}
                        </p>
                      </div>
                      {visit.status === 'completed' && (
                        <span className="text-sm text-foreground-secondary">
                          {formatAmount(visit.amount)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {visits.length > 5 && (
                <button
                  className="text-sm text-sage-600 hover:text-sage-700 hover:underline"
                  disabled
                >
                  {t('clients.drawer.visits.viewAll')} ({visits.length})
                </button>
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

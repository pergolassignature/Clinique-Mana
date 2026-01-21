import { User, Heart, Home, UsersRound } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import type { DemandeListItem, DemandType, DemandeStatus, UrgencyLevel } from '../types'

interface DemandesTableRowProps {
  demande: DemandeListItem
  visibleColumns: Set<string>
  onClick?: () => void
}

// Status badge configuration
const statusConfig: Record<DemandeStatus, { variant: 'warning' | 'success' | 'secondary'; labelKey: string }> = {
  toAnalyze: { variant: 'warning', labelKey: 'demandes.list.status.toAnalyze' },
  assigned: { variant: 'success', labelKey: 'demandes.list.status.assigned' },
  closed: { variant: 'secondary', labelKey: 'demandes.list.status.closed' },
}

// Type icon configuration
const typeConfig: Record<DemandType, { icon: typeof User; labelKey: string }> = {
  individual: { icon: User, labelKey: 'demandes.list.type.individual' },
  couple: { icon: Heart, labelKey: 'demandes.list.type.couple' },
  family: { icon: Home, labelKey: 'demandes.list.type.family' },
  group: { icon: UsersRound, labelKey: 'demandes.list.type.group' },
}

// Urgency badge configuration
const urgencyConfig: Record<UrgencyLevel, { variant: 'success' | 'warning' | 'error'; labelKey: string }> = {
  low: { variant: 'success', labelKey: 'demandes.list.urgency.low' },
  moderate: { variant: 'warning', labelKey: 'demandes.list.urgency.moderate' },
  high: { variant: 'error', labelKey: 'demandes.list.urgency.high' },
}

export function DemandesTableRow({ demande, visibleColumns, onClick }: DemandesTableRowProps) {
  // Format ID to show only the last part (e.g., DEM-2026-0042 -> 2026-0042)
  const shortId = demande.id.replace('DEM-', '')

  // Format date relative
  const formatRelativeDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffTime = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return "Aujourd'hui"
    if (diffDays === 1) return 'Hier'
    if (diffDays < 7) return `Il y a ${diffDays} jours`
    if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} sem.`
    if (diffDays < 365) return `Il y a ${Math.floor(diffDays / 30)} mois`
    return `Il y a ${Math.floor(diffDays / 365)} an${Math.floor(diffDays / 365) > 1 ? 's' : ''}`
  }

  const statusCfg = statusConfig[demande.status]
  const typeCfg = demande.demandType ? typeConfig[demande.demandType] : null
  const urgencyCfg = demande.urgency ? urgencyConfig[demande.urgency] : null

  return (
    <tr
      onClick={onClick}
      className={cn(
        'hover:bg-sage-50/50 transition-colors',
        onClick && 'cursor-pointer'
      )}
    >
      {/* ID */}
      {visibleColumns.has('id') && (
        <td className="px-4 py-4 text-sm font-mono text-foreground-secondary">
          {shortId}
        </td>
      )}

      {/* Status */}
      {visibleColumns.has('status') && (
        <td className="px-4 py-4">
          <Badge variant={statusCfg.variant}>
            {t(statusCfg.labelKey as Parameters<typeof t>[0])}
          </Badge>
        </td>
      )}

      {/* Type */}
      {visibleColumns.has('type') && (
        <td className="px-4 py-4">
          {typeCfg ? (
            <div className="flex items-center gap-1.5 text-sm text-foreground-secondary">
              <typeCfg.icon className="h-4 w-4" />
              <span>{t(typeCfg.labelKey as Parameters<typeof t>[0])}</span>
            </div>
          ) : (
            <span className="text-sm text-foreground-muted">—</span>
          )}
        </td>
      )}

      {/* Client(s) */}
      {visibleColumns.has('clients') && (
        <td className="px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {demande.primaryClientName || '—'}
            </span>
            {demande.participantCount > 1 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                +{demande.participantCount - 1}
              </Badge>
            )}
          </div>
        </td>
      )}

      {/* Motifs */}
      {visibleColumns.has('motifs') && (
        <td className="px-4 py-4">
          <div className="flex items-center gap-1 flex-wrap">
            {demande.motifLabels.map((label, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {label}
              </Badge>
            ))}
            {demande.motifCount > 2 && (
              <span className="text-xs text-foreground-muted">
                +{demande.motifCount - 2}
              </span>
            )}
            {demande.motifLabels.length === 0 && (
              <span className="text-sm text-foreground-muted">—</span>
            )}
          </div>
        </td>
      )}

      {/* Date */}
      {visibleColumns.has('createdAt') && (
        <td className="px-4 py-4 text-sm text-foreground-secondary">
          {formatRelativeDate(demande.createdAt)}
        </td>
      )}

      {/* Urgency */}
      {visibleColumns.has('urgency') && (
        <td className="px-4 py-4">
          {urgencyCfg ? (
            <Badge variant={urgencyCfg.variant}>
              {t(urgencyCfg.labelKey as Parameters<typeof t>[0])}
            </Badge>
          ) : (
            <span className="text-sm text-foreground-muted">—</span>
          )}
        </td>
      )}
    </tr>
  )
}

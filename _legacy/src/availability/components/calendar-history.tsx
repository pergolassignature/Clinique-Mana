// src/availability/components/calendar-history.tsx

import { useState } from 'react'
import {
  History,
  User,
  CheckCircle,
  AlertCircle,
  Info,
  XCircle,
  ChevronDown,
  ChevronUp,
  Bot,
  Copy,
} from 'lucide-react'
import type { AppointmentAuditLog, HumanizedCalendarAuditEntry } from '../types'
import { mapCalendarAuditLogToHumanized, formatEntityId, isUUID } from '../utils/audit-mappers'
import { EmptyState } from '@/shared/components/empty-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { useToast } from '@/shared/hooks/use-toast'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'

// =============================================================================
// Formatting helpers
// =============================================================================

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('fr-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "À l'instant"
  if (diffMins < 60) return `Il y a ${diffMins} min`
  if (diffHours < 24) return `Il y a ${diffHours} h`
  if (diffDays < 7) return `Il y a ${diffDays} jour${diffDays > 1 ? 's' : ''}`

  return date.toLocaleDateString('fr-CA', {
    month: 'short',
    day: 'numeric',
  })
}

function getIconForType(iconType: HumanizedCalendarAuditEntry['iconType']) {
  switch (iconType) {
    case 'success':
      return <CheckCircle className="h-4 w-4" />
    case 'error':
      return <XCircle className="h-4 w-4" />
    case 'warning':
      return <AlertCircle className="h-4 w-4" />
    default:
      return <Info className="h-4 w-4" />
  }
}

function getIconColorClass(iconType: HumanizedCalendarAuditEntry['iconType']) {
  switch (iconType) {
    case 'success':
      return 'bg-sage-100 text-sage-600'
    case 'error':
      return 'bg-wine-100 text-wine-600'
    case 'warning':
      return 'bg-honey-100 text-honey-600'
    default:
      return 'bg-background-secondary text-foreground-muted'
  }
}

function formatDetailsForDisplay(details: Record<string, unknown>): Record<string, unknown> {
  const formatted: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(details)) {
    if (key === 'id' || key.endsWith('_id')) {
      if (typeof value === 'string' && isUUID(value)) {
        formatted[key] = formatEntityId(value)
      } else {
        formatted[key] = value
      }
    } else if (typeof value === 'string' && isUUID(value)) {
      formatted[key] = formatEntityId(value)
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      formatted[key] = formatDetailsForDisplay(value as Record<string, unknown>)
    } else {
      formatted[key] = value
    }
  }

  return formatted
}

function extractFullIds(details: Record<string, unknown>): { key: string; fullId: string }[] {
  const ids: { key: string; fullId: string }[] = []

  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'string' && isUUID(value)) {
      ids.push({ key, fullId: value })
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      ids.push(...extractFullIds(value as Record<string, unknown>).map(item => ({
        key: `${key}.${item.key}`,
        fullId: item.fullId,
      })))
    }
  }

  return ids
}

// =============================================================================
// Timeline Entry Component
// =============================================================================

function TimelineEntry({ entry }: { entry: HumanizedCalendarAuditEntry }) {
  const [showDetails, setShowDetails] = useState(false)
  const { toast } = useToast()

  const handleCopyId = async (fullId: string, label: string) => {
    await navigator.clipboard.writeText(fullId)
    toast({
      title: 'ID copié',
      description: `${label} copié dans le presse-papiers.`,
    })
  }

  const formattedDetails = entry.details ? formatDetailsForDisplay(entry.details) : null
  const fullIds = entry.details ? extractFullIds(entry.details) : []

  return (
    <div className="flex gap-3 py-3">
      {/* Icon */}
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${getIconColorClass(
          entry.iconType
        )}`}
      >
        {getIconForType(entry.iconType)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Main label */}
        <div className="flex items-start gap-2">
          <p className="text-sm font-medium text-foreground">
            {entry.labelFr}
            {entry.descriptionFr && (
              <span className="font-normal text-foreground-muted ml-1">
                — {entry.descriptionFr}
              </span>
            )}
          </p>
        </div>

        {/* Metadata */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-foreground-muted">
          <span title={formatDateTime(entry.createdAt)}>
            {formatRelativeTime(entry.createdAt)}
          </span>

          <span>•</span>

          {entry.isSystem ? (
            <span className="flex items-center gap-1">
              <Bot className="h-3 w-3" />
              Système
            </span>
          ) : entry.actorName ? (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {entry.actorName}
            </span>
          ) : (
            <span>Utilisateur inconnu</span>
          )}
        </div>

        {/* Details toggle */}
        {entry.hasDetails && (
          <div className="mt-1.5">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground transition-colors"
            >
              {showDetails ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Masquer
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Détails
                </>
              )}
            </button>

            {showDetails && formattedDetails && (
              <div className="mt-1.5 rounded-lg bg-background-secondary/50 px-2.5 py-2 text-xs">
                <pre className="whitespace-pre-wrap break-all text-foreground-muted font-mono text-[11px]">
                  {JSON.stringify(formattedDetails, null, 2)}
                </pre>

                {fullIds.length > 0 && (
                  <div className="mt-2 pt-1.5 border-t border-border flex flex-wrap gap-1.5">
                    {fullIds.map(({ key, fullId }) => (
                      <button
                        key={key}
                        onClick={() => handleCopyId(fullId, key)}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-background hover:bg-sage-50 text-foreground-muted hover:text-foreground transition-colors"
                      >
                        <Copy className="h-2.5 w-2.5" />
                        {key}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Loading Skeleton
// =============================================================================

function HistorySkeleton({ compact }: { compact?: boolean }) {
  const count = compact ? 3 : 5
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-7 w-7 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-1 h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

// =============================================================================
// Compact Timeline (for appointment detail)
// =============================================================================

interface CompactHistoryProps {
  auditLog: AppointmentAuditLog[] | undefined
  isLoading: boolean
  emptyMessage?: string
}

export function CompactCalendarHistory({
  auditLog,
  isLoading,
  emptyMessage = "Aucun historique disponible.",
}: CompactHistoryProps) {
  if (isLoading) {
    return <HistorySkeleton compact />
  }

  if (!auditLog || auditLog.length === 0) {
    return (
      <div className="text-sm text-foreground-muted py-4 text-center">
        {emptyMessage}
      </div>
    )
  }

  const humanizedEntries = mapCalendarAuditLogToHumanized(auditLog)

  return (
    <div className="divide-y divide-border">
      {humanizedEntries.slice(0, 10).map((entry) => (
        <TimelineEntry key={entry.id} entry={entry} />
      ))}
      {humanizedEntries.length > 10 && (
        <div className="pt-2 text-xs text-foreground-muted text-center">
          +{humanizedEntries.length - 10} autres événements
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Full History Panel (for professional calendar view)
// =============================================================================

interface CalendarHistoryPanelProps {
  auditLog: AppointmentAuditLog[] | undefined
  isLoading: boolean
  title?: string
}

export function CalendarHistoryPanel({
  auditLog,
  isLoading,
  title = "Historique du calendrier",
}: CalendarHistoryPanelProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <HistorySkeleton />
        </CardContent>
      </Card>
    )
  }

  if (!auditLog || auditLog.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<History className="h-6 w-6" />}
            title="Aucun historique"
            description="L'historique des modifications apparaîtra ici."
          />
        </CardContent>
      </Card>
    )
  }

  const humanizedEntries = mapCalendarAuditLogToHumanized(auditLog)

  // Group by date
  const groupedByDate: Record<string, HumanizedCalendarAuditEntry[]> = {}
  humanizedEntries.forEach((entry) => {
    const dateKey = new Date(entry.createdAt).toLocaleDateString('fr-CA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    if (!groupedByDate[dateKey]) {
      groupedByDate[dateKey] = []
    }
    groupedByDate[dateKey].push(entry)
  })

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-foreground-muted" />
            <div>
              <h3 className="text-sm font-medium text-foreground">{title}</h3>
              <p className="text-xs text-foreground-muted">
                {humanizedEntries.length} événement{humanizedEntries.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Timeline grouped by date */}
      {Object.entries(groupedByDate).map(([date, entries]) => (
        <Card key={date}>
          <CardHeader className="pb-0 pt-3">
            <CardTitle className="text-xs text-foreground-muted font-normal">
              {date}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 pb-2">
            <div className="divide-y divide-border">
              {entries.map((entry) => (
                <TimelineEntry key={entry.id} entry={entry} />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

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
import type { ProfessionalWithRelations } from '../types'
import { useProfessionalAuditLog } from '../hooks'
import { mapAuditLogToHumanized, formatEntityId, isUUID, type HumanizedAuditEntry } from '../mappers'
import { EmptyState } from '@/shared/components/empty-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { useToast } from '@/shared/hooks/use-toast'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card'

interface ProfessionalHistoryTabProps {
  professional: ProfessionalWithRelations
}

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

function getIconForType(iconType: HumanizedAuditEntry['iconType']) {
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

function getIconColorClass(iconType: HumanizedAuditEntry['iconType']) {
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

/**
 * Formats details object for display, replacing UUIDs with short IDs
 */
function formatDetailsForDisplay(details: Record<string, unknown>): Record<string, unknown> {
  const formatted: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(details)) {
    // Skip ID fields in top-level display
    if (key === 'id' || key.endsWith('_id')) {
      if (typeof value === 'string' && isUUID(value)) {
        formatted[key] = formatEntityId(value)
      } else {
        formatted[key] = value
      }
    } else if (typeof value === 'string' && isUUID(value)) {
      // Format any UUID-like strings
      formatted[key] = formatEntityId(value)
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively format nested objects
      formatted[key] = formatDetailsForDisplay(value as Record<string, unknown>)
    } else {
      formatted[key] = value
    }
  }

  return formatted
}

/**
 * Extracts any full UUIDs from details for the "copy full ID" feature
 */
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

function TimelineEntry({ entry }: { entry: HumanizedAuditEntry }) {
  const [showDetails, setShowDetails] = useState(false)
  const { toast } = useToast()

  const handleCopyId = async (fullId: string, label: string) => {
    await navigator.clipboard.writeText(fullId)
    toast({
      title: 'ID copié',
      description: `${label} copié dans le presse-papiers.`,
    })
  }

  // Format details for display (short IDs) and extract full IDs for copy action
  const formattedDetails = entry.details ? formatDetailsForDisplay(entry.details) : null
  const fullIds = entry.details ? extractFullIds(entry.details) : []

  return (
    <div className="flex gap-3 py-4">
      {/* Icon */}
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${getIconColorClass(
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
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-foreground-muted">
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

          {/* Short ID display */}
          <span>•</span>
          <span className="font-mono" title="Identifiant de l'événement">
            {formatEntityId(entry.id)}
          </span>
        </div>

        {/* Details toggle */}
        {entry.hasDetails && (
          <div className="mt-2">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-xs text-foreground-muted hover:text-foreground transition-colors"
            >
              {showDetails ? (
                <>
                  <ChevronUp className="h-3 w-3" />
                  Masquer les détails
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" />
                  Voir les détails
                </>
              )}
            </button>

            {showDetails && formattedDetails && (
              <div className="mt-2 rounded-lg bg-background-secondary/50 px-3 py-2 text-xs">
                {/* Formatted details without raw UUIDs */}
                <pre className="whitespace-pre-wrap break-all text-foreground-muted font-mono">
                  {JSON.stringify(formattedDetails, null, 2)}
                </pre>

                {/* Copy full ID actions */}
                {fullIds.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-border flex flex-wrap gap-2">
                    {fullIds.map(({ key, fullId }) => (
                      <button
                        key={key}
                        onClick={() => handleCopyId(fullId, key)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-background hover:bg-sage-50 text-foreground-muted hover:text-foreground transition-colors"
                      >
                        <Copy className="h-3 w-3" />
                        Copier {key}
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

export function ProfessionalHistoryTab({ professional }: ProfessionalHistoryTabProps) {
  const { data: auditLog, isLoading } = useProfessionalAuditLog(professional.id)

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="mt-1 h-4 w-32" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!auditLog || auditLog.length === 0) {
    return (
      <EmptyState
        icon={<History className="h-8 w-8" />}
        title="Aucun historique"
        description="L'historique des modifications apparaîtra ici au fur et à mesure que des changements sont effectués."
      />
    )
  }

  // Humanize the audit log
  const humanizedEntries = mapAuditLogToHumanized(auditLog)

  // Group by date
  const groupedByDate: Record<string, HumanizedAuditEntry[]> = {}
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
    <div className="space-y-6">
      {/* Summary */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-medium text-foreground">
                Historique des modifications
              </h3>
              <p className="text-sm text-foreground-muted">
                {humanizedEntries.length} événement{humanizedEntries.length !== 1 ? 's' : ''} enregistré{humanizedEntries.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Timeline */}
      {Object.entries(groupedByDate).map(([date, entries]) => (
        <Card key={date}>
          <CardHeader className="pb-0">
            <CardTitle className="text-sm text-foreground-muted font-normal">
              {date}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="divide-y divide-border">
              {entries.map((entry) => (
                <TimelineEntry key={entry.id} entry={entry} />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Footer note */}
      <div className="rounded-lg border border-border bg-background-secondary/30 p-4 text-xs text-foreground-muted">
        <p>
          L'historique enregistre automatiquement toutes les modifications apportées au profil professionnel,
          aux documents, aux invitations et aux questionnaires. Les détails techniques sont masqués par défaut.
        </p>
      </div>
    </div>
  )
}

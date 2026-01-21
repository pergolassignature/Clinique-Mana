import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  History,
  User,
  ChevronDown,
  ChevronUp,
  Bot,
  Pencil,
  Plus,
  Trash2,
  FileCheck,
  StickyNote,
  Tag,
  Briefcase,
} from 'lucide-react'
import { t } from '@/i18n'
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/shared/ui/accordion'
import { Badge } from '@/shared/ui/badge'
import { supabase } from '@/lib/supabaseClient'
import type { ClientWithRelations } from '../../types'

// =============================================================================
// TYPES
// =============================================================================

export interface ClientAuditEntry {
  id: string
  clientId: string
  action: 'create' | 'update' | 'delete' | 'add' | 'remove' | 'created' | 'updated' | 'archived' | 'unarchived' | 'deleted'
  entity: 'client' | 'note' | 'consent' | 'tag' | 'professional'
  field?: string
  oldValue?: Record<string, unknown> | null
  newValue?: Record<string, unknown> | null
  actorId: string | null
  actorName: string | null
  isSystem: boolean
  createdAt: string
}

// =============================================================================
// FETCH AUDIT LOG
// =============================================================================

async function fetchClientAuditLog(clientUuid: string): Promise<ClientAuditEntry[]> {
  const { data, error } = await supabase
    .from('client_audit_log')
    .select(`
      id,
      client_id,
      actor_id,
      action,
      entity_type,
      old_value,
      new_value,
      created_at,
      profiles:actor_id (
        display_name
      )
    `)
    .eq('client_id', clientUuid)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('Error fetching audit log:', error)
    return []
  }

  return (data || []).map((row): ClientAuditEntry => {
    const profile = row.profiles as { display_name: string }[] | null
    const profileData = Array.isArray(profile) ? profile[0] : profile
    return {
      id: row.id,
      clientId: row.client_id,
      action: row.action as ClientAuditEntry['action'],
      entity: row.entity_type as ClientAuditEntry['entity'],
      oldValue: row.old_value,
      newValue: row.new_value,
      actorId: row.actor_id,
      actorName: profileData?.display_name || null,
      isSystem: !row.actor_id,
      createdAt: row.created_at,
    }
  })
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "A l'instant"
  if (diffMins < 60) return `Il y a ${diffMins} min`
  if (diffHours < 24) return `Il y a ${diffHours} h`
  if (diffDays < 7) return `Il y a ${diffDays} jour${diffDays > 1 ? 's' : ''}`
  if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} sem.`

  return date.toLocaleDateString('fr-CA', {
    month: 'short',
    day: 'numeric',
  })
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

function getActionIcon(entry: ClientAuditEntry) {
  switch (entry.entity) {
    case 'note':
      return <StickyNote className="h-3.5 w-3.5" />
    case 'consent':
      return <FileCheck className="h-3.5 w-3.5" />
    case 'tag':
      return <Tag className="h-3.5 w-3.5" />
    case 'professional':
      return <Briefcase className="h-3.5 w-3.5" />
    default:
      if (entry.action === 'create' || entry.action === 'created') return <Plus className="h-3.5 w-3.5" />
      if (entry.action === 'delete' || entry.action === 'deleted') return <Trash2 className="h-3.5 w-3.5" />
      return <Pencil className="h-3.5 w-3.5" />
  }
}

function getActionColor(entry: ClientAuditEntry): string {
  switch (entry.action) {
    case 'create':
    case 'created':
    case 'add':
      return 'bg-sage-100 text-sage-600'
    case 'delete':
    case 'deleted':
    case 'remove':
    case 'archived':
      return 'bg-wine-100 text-wine-600'
    case 'unarchived':
      return 'bg-sage-100 text-sage-600'
    default:
      return 'bg-background-secondary text-foreground-muted'
  }
}

function getActionLabel(entry: ClientAuditEntry): string {
  const fieldLabels: Record<string, string> = {
    first_name: 'prénom',
    last_name: 'nom',
    sex: 'sexe',
    language: 'langue',
    birthday: 'date de naissance',
    email: 'courriel',
    cell_phone: 'cellulaire',
    home_phone: 'téléphone domicile',
    work_phone: 'téléphone travail',
    street_number: 'numéro civique',
    street_name: 'rue',
    apartment: 'appartement',
    city: 'ville',
    province: 'province',
    country: 'pays',
    postal_code: 'code postal',
    primary_professional_id: 'professionnel assigné',
  }

  switch (entry.action) {
    case 'created':
    case 'create':
      return 'Fiche client créée'
    case 'archived':
      return 'Client archivé'
    case 'unarchived':
      return 'Client désarchivé'
    case 'deleted':
    case 'delete':
      return 'Client supprimé'
    case 'updated':
    case 'update':
      // Try to find which field changed
      if (entry.oldValue && entry.newValue) {
        const oldKeys = Object.keys(entry.oldValue)
        for (const key of oldKeys) {
          if (entry.oldValue[key] !== entry.newValue[key]) {
            const fieldLabel = fieldLabels[key] || key
            return `${fieldLabel.charAt(0).toUpperCase() + fieldLabel.slice(1)} modifié`
          }
        }
      }
      return 'Informations modifiées'
    case 'add':
      switch (entry.entity) {
        case 'note': return 'Note ajoutée'
        case 'consent': return 'Consentement ajouté'
        case 'tag': return 'Tag ajouté'
        default: return 'Élément ajouté'
      }
    case 'remove':
      switch (entry.entity) {
        case 'note': return 'Note supprimée'
        case 'consent': return 'Consentement retiré'
        case 'tag': return 'Tag retiré'
        default: return 'Élément supprimé'
      }
    default:
      return 'Modification'
  }
}

function getChangeDescription(entry: ClientAuditEntry): string | null {
  if (entry.oldValue && entry.newValue && typeof entry.oldValue === 'object') {
    // Find changed fields and show old -> new
    const changes: string[] = []
    const keys = Object.keys(entry.newValue)
    for (const key of keys) {
      const oldVal = entry.oldValue[key]
      const newVal = entry.newValue[key]
      if (oldVal !== newVal) {
        const oldDisplay = oldVal ?? 'vide'
        const newDisplay = newVal ?? 'vide'
        changes.push(`${oldDisplay} → ${newDisplay}`)
      }
    }
    return changes.length > 0 ? changes.join(', ') : null
  }
  if (entry.newValue && typeof entry.newValue === 'object') {
    // For create actions, show key info
    const nv = entry.newValue as Record<string, unknown>
    if (nv.first_name && nv.last_name) {
      return `${nv.first_name} ${nv.last_name}`
    }
  }
  return null
}

// =============================================================================
// TIMELINE ENTRY COMPONENT
// =============================================================================

function TimelineEntry({ entry }: { entry: ClientAuditEntry }) {
  const description = getChangeDescription(entry)

  return (
    <div className="flex gap-3 py-3">
      {/* Icon */}
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${getActionColor(entry)}`}
      >
        {getActionIcon(entry)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Main label */}
        <div className="flex items-start gap-2">
          <p className="text-sm font-medium text-foreground">
            {getActionLabel(entry)}
          </p>
        </div>

        {/* Change description */}
        {description && (
          <p className="text-xs text-foreground-secondary mt-0.5 truncate">
            {description}
          </p>
        )}

        {/* Metadata */}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-foreground-muted">
          <span title={formatDateTime(entry.createdAt)}>
            {formatRelativeTime(entry.createdAt)}
          </span>

          <span>•</span>

          {entry.isSystem ? (
            <span className="flex items-center gap-1">
              <Bot className="h-3 w-3" />
              Systeme
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
      </div>
    </div>
  )
}

// =============================================================================
// HISTORY SECTION COMPONENT
// =============================================================================

interface HistorySectionProps {
  client: ClientWithRelations
}

export function HistorySection({ client }: HistorySectionProps) {
  const [expanded, setExpanded] = useState(false)

  // Fetch real audit log from database
  const { data: auditLog = [], isLoading } = useQuery({
    queryKey: ['client-audit-log', client.id],
    queryFn: () => fetchClientAuditLog(client.id),
    enabled: !!client.id,
  })

  // Show first 3 entries by default, all when expanded
  const visibleEntries = expanded ? auditLog : auditLog.slice(0, 3)
  const hasMore = auditLog.length > 3

  return (
    <AccordionItem value="history" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-sage-500" />
          <span>{t('clients.drawer.sections.history')}</span>
          <Badge variant="secondary" className="ml-2 text-xs">
            {auditLog.length}
          </Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-1">
          {isLoading ? (
            <p className="text-sm text-foreground-muted py-4">Chargement...</p>
          ) : auditLog.length === 0 ? (
            <p className="text-sm text-foreground-muted italic py-4">Aucun historique disponible</p>
          ) : (
            <>
              {/* Timeline */}
              <div className="divide-y divide-border">
                {visibleEntries.map((entry) => (
                  <TimelineEntry key={entry.id} entry={entry} />
                ))}
              </div>

              {/* Show more/less button */}
              {hasMore && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="flex items-center gap-1 text-xs text-sage-600 hover:text-sage-700 transition-colors pt-2"
                >
                  {expanded ? (
                    <>
                      <ChevronUp className="h-3 w-3" />
                      Voir moins
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" />
                      Voir tout l'historique ({auditLog.length - 3} autres)
                    </>
                  )}
                </button>
              )}
            </>
          )}

          {/* Footer note */}
          <p className="text-xs text-foreground-muted pt-3 border-t border-border mt-3">
            L'historique enregistre automatiquement toutes les modifications apportees a la fiche client.
          </p>
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

import { useState } from 'react'
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
import type { ClientWithRelations } from '../../types'

// =============================================================================
// TYPES
// =============================================================================

export interface ClientAuditEntry {
  id: string
  clientId: string
  action: 'create' | 'update' | 'delete' | 'add' | 'remove'
  entity: 'client' | 'note' | 'consent' | 'tag' | 'professional'
  field?: string
  oldValue?: string | null
  newValue?: string | null
  actorId: string | null
  actorName: string | null
  isSystem: boolean
  createdAt: string
  details?: Record<string, unknown>
}

// =============================================================================
// MOCK AUDIT DATA
// =============================================================================

export function generateMockAuditLog(clientId: string): ClientAuditEntry[] {
  const now = new Date()

  return [
    {
      id: 'audit-1',
      clientId,
      action: 'update',
      entity: 'client',
      field: 'cellPhone',
      oldValue: '+1 514-555-0100',
      newValue: '+1 514-555-0109',
      actorId: 'pro-2',
      actorName: 'Jean-Philippe Bouchard',
      isSystem: false,
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    },
    {
      id: 'audit-2',
      clientId,
      action: 'add',
      entity: 'note',
      newValue: 'Client a confirme son prochain rendez-vous.',
      actorId: 'pro-1',
      actorName: 'Dre Marie Tremblay',
      isSystem: false,
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    },
    {
      id: 'audit-3',
      clientId,
      action: 'update',
      entity: 'professional',
      oldValue: null,
      newValue: 'Jean-Philippe Bouchard',
      actorId: 'admin-1',
      actorName: 'Admin Clinique',
      isSystem: false,
      createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
    },
    {
      id: 'audit-4',
      clientId,
      action: 'add',
      entity: 'consent',
      newValue: 'Consentement aux soins',
      actorId: 'pro-1',
      actorName: 'Dre Marie Tremblay',
      isSystem: false,
      createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week ago
    },
    {
      id: 'audit-5',
      clientId,
      action: 'add',
      entity: 'tag',
      newValue: 'Regulier',
      actorId: null,
      actorName: null,
      isSystem: true,
      createdAt: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(), // 2 weeks ago
    },
    {
      id: 'audit-6',
      clientId,
      action: 'update',
      entity: 'client',
      field: 'email',
      oldValue: null,
      newValue: 'client@example.com',
      actorId: 'pro-2',
      actorName: 'Jean-Philippe Bouchard',
      isSystem: false,
      createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 1 month ago
    },
    {
      id: 'audit-7',
      clientId,
      action: 'create',
      entity: 'client',
      actorId: 'admin-1',
      actorName: 'Admin Clinique',
      isSystem: false,
      createdAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(), // 2 months ago
    },
  ]
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
      if (entry.action === 'create') return <Plus className="h-3.5 w-3.5" />
      if (entry.action === 'delete') return <Trash2 className="h-3.5 w-3.5" />
      return <Pencil className="h-3.5 w-3.5" />
  }
}

function getActionColor(entry: ClientAuditEntry): string {
  switch (entry.action) {
    case 'create':
      return 'bg-sage-100 text-sage-600'
    case 'add':
      return 'bg-sage-100 text-sage-600'
    case 'delete':
    case 'remove':
      return 'bg-wine-100 text-wine-600'
    default:
      return 'bg-background-secondary text-foreground-muted'
  }
}

function getActionLabel(entry: ClientAuditEntry): string {
  const fieldLabels: Record<string, string> = {
    firstName: 'prenom',
    lastName: 'nom',
    birthFirstName: 'prenom de naissance',
    pronouns: 'pronoms',
    sex: 'sexe',
    language: 'langue',
    birthday: 'date de naissance',
    email: 'courriel',
    cellPhone: 'cellulaire',
    homePhone: 'telephone domicile',
    workPhone: 'telephone travail',
    streetNumber: 'numero civique',
    streetName: 'rue',
    apartment: 'appartement',
    city: 'ville',
    province: 'province',
    country: 'pays',
    postalCode: 'code postal',
  }

  switch (entry.entity) {
    case 'client':
      if (entry.action === 'create') return 'Fiche client creee'
      if (entry.field) {
        const fieldLabel = fieldLabels[entry.field] || entry.field
        return `${fieldLabel.charAt(0).toUpperCase() + fieldLabel.slice(1)} modifie`
      }
      return 'Informations modifiees'
    case 'note':
      return entry.action === 'add' ? 'Note ajoutee' : 'Note supprimee'
    case 'consent':
      return entry.action === 'add' ? 'Consentement ajoute' : 'Consentement retire'
    case 'tag':
      return entry.action === 'add' ? 'Tag ajoute' : 'Tag retire'
    case 'professional':
      return 'Professionnel assigne'
    default:
      return 'Modification'
  }
}

function getChangeDescription(entry: ClientAuditEntry): string | null {
  if (entry.entity === 'client' && entry.field && entry.oldValue !== undefined) {
    const old = entry.oldValue || 'vide'
    const newVal = entry.newValue || 'vide'
    return `${old} → ${newVal}`
  }
  if (entry.newValue && entry.entity !== 'client') {
    return entry.newValue
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

  // Generate mock audit log for this client
  const auditLog = generateMockAuditLog(client.clientId)

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

          {/* Footer note */}
          <p className="text-xs text-foreground-muted pt-3 border-t border-border mt-3">
            L'historique enregistre automatiquement toutes les modifications apportees a la fiche client.
          </p>
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

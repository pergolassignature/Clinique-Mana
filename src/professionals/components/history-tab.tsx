import { History, User } from 'lucide-react'
import { t } from '@/i18n'
import type { ProfessionalWithRelations, AuditAction } from '../types'
import { useProfessionalAuditLog } from '../hooks'
import { EmptyState } from '@/shared/components/empty-state'
import { Skeleton } from '@/shared/ui/skeleton'

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

function getActionLabel(action: AuditAction): string {
  const key = `professionals.history.actions.${action}` as Parameters<typeof t>[0]
  return t(key)
}

function getActionColor(action: AuditAction): string {
  if (action.includes('deleted') || action.includes('rejected') || action.includes('revoked')) {
    return 'bg-wine-100 text-wine-600'
  }
  if (action.includes('verified') || action.includes('approved') || action.includes('completed')) {
    return 'bg-sage-100 text-sage-600'
  }
  if (action.includes('created') || action.includes('uploaded') || action.includes('added')) {
    return 'bg-sage-100 text-sage-600'
  }
  return 'bg-background-secondary text-foreground-muted'
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
        title={t('professionals.history.empty.title')}
        description={t('professionals.history.empty.description')}
      />
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-background">
      <div className="divide-y divide-border">
        {auditLog.map((entry) => (
          <div key={entry.id} className="flex gap-4 p-4">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${getActionColor(
                entry.action
              )}`}
            >
              <User className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {getActionLabel(entry.action)}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-foreground-muted">
                <span>{formatDateTime(entry.created_at)}</span>
                {entry.actor && (
                  <>
                    <span>•</span>
                    <span>
                      {t('professionals.history.by')} {entry.actor.display_name}
                    </span>
                  </>
                )}
                {!entry.actor && entry.actor_id === null && (
                  <>
                    <span>•</span>
                    <span>{t('professionals.history.system')}</span>
                  </>
                )}
              </div>

              {/* Show changed values for certain actions */}
              {entry.new_value && Object.keys(entry.new_value).length > 0 && (
                <div className="mt-2 rounded-lg bg-background-secondary px-3 py-2 text-xs">
                  {Object.entries(entry.new_value).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <span className="text-foreground-muted">{key}:</span>
                      <span className="text-foreground">
                        {typeof value === 'string' ? value : JSON.stringify(value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

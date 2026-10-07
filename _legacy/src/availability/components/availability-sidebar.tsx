// src/availability/components/availability-sidebar.tsx

import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Plus, Ban, Clock, History, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import type { AvailabilityBlock } from '../types'
import { CompactCalendarHistory } from './calendar-history'
import { useProfessionalCalendarAuditLog } from '../hooks'

interface AvailabilitySidebarProps {
  availabilityBlocks: AvailabilityBlock[]
  weekStartDate: Date
  professionalId: string | null
  onCreateAvailability: (type: 'available' | 'blocked') => void
  onBlockClick: (block: AvailabilityBlock) => void
}

const TYPE_LABELS: Record<string, string> = {
  available: 'Disponible',
  blocked: 'Bloque',
  vacation: 'Vacances',
  break: 'Pause',
}

const TYPE_COLORS: Record<string, string> = {
  available: 'bg-sage-100 text-sage-700',
  blocked: 'bg-wine-100 text-wine-700',
  vacation: 'bg-amber-100 text-amber-700',
  break: 'bg-slate-100 text-slate-600',
}

export function AvailabilitySidebar({
  availabilityBlocks,
  weekStartDate,
  professionalId,
  onCreateAvailability,
  onBlockClick,
}: AvailabilitySidebarProps) {
  const [showHistory, setShowHistory] = useState(false)

  // Fetch audit log for the professional
  const { data: auditLog, isLoading: auditLoading } = useProfessionalCalendarAuditLog(
    professionalId || '',
    20 // Limit to recent 20 events
  )

  // Filter blocks for current week
  const weekBlocks = useMemo(() => {
    const weekEnd = new Date(weekStartDate)
    weekEnd.setDate(weekEnd.getDate() + 7)

    return availabilityBlocks
      .filter(block => {
        const blockStart = new Date(block.startTime)
        return blockStart >= weekStartDate && blockStart < weekEnd
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  }, [availabilityBlocks, weekStartDate])

  return (
    <div className="flex flex-col h-full p-4">
      {/* Quick actions */}
      <div className="space-y-2 mb-6">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
          Actions rapides
        </h3>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => onCreateAvailability('available')}
        >
          <Plus className="h-4 w-4 text-sage-600" />
          Disponible
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => onCreateAvailability('blocked')}
        >
          <Ban className="h-4 w-4 text-wine-600" />
          Bloquer temps
        </Button>
      </div>

      {/* Blocks list */}
      <div className="flex-1 overflow-y-auto">
        <h3 className="text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-3">
          Blocs cette semaine
        </h3>

        {weekBlocks.length === 0 ? (
          <p className="text-sm text-foreground-muted">Aucun bloc defini</p>
        ) : (
          <div className="space-y-2">
            {weekBlocks.map(block => {
              const startDate = new Date(block.startTime)
              const endDate = new Date(block.endTime)

              return (
                <button
                  key={block.id}
                  onClick={() => onBlockClick(block)}
                  className="w-full text-left p-2 rounded-lg hover:bg-background-tertiary/50 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn('px-1.5 py-0.5 text-[10px] font-medium rounded', TYPE_COLORS[block.type])}>
                      {TYPE_LABELS[block.type]}
                    </span>
                    {block.label && (
                      <span className="text-xs text-foreground-muted truncate">{block.label}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-foreground-secondary">
                    <Clock className="h-3 w-3" />
                    {format(startDate, 'EEE d', { locale: fr })} · {format(startDate, 'HH:mm')}–{format(endDate, 'HH:mm')}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* History section */}
      {professionalId && (
        <div className="border-t border-border pt-4 mt-4">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between text-xs font-semibold text-foreground-muted uppercase tracking-wider mb-2 hover:text-foreground transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" />
              Historique récent
            </span>
            {showHistory ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>

          {showHistory && (
            <div className="max-h-64 overflow-y-auto">
              <CompactCalendarHistory
                auditLog={auditLog}
                isLoading={auditLoading}
                emptyMessage="Aucune modification récente."
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

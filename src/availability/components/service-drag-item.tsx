// src/availability/components/service-drag-item.tsx

import { GripVertical, User, Users } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { BookableService } from '../types'

interface ServiceDragItemProps {
  service: BookableService
  onDragStart: (e: React.DragEvent, service: BookableService) => void
  disabled?: boolean
}

const CLIENT_TYPE_ICONS = {
  individual: User,
  couple: Users,
  family: Users,
}

const CLIENT_TYPE_LABELS = {
  individual: 'Individuel',
  couple: 'Couple',
  family: 'Famille',
}

export function ServiceDragItem({ service, onDragStart, disabled }: ServiceDragItemProps) {
  const Icon = CLIENT_TYPE_ICONS[service.clientType]

  return (
    <div
      draggable={!disabled}
      onDragStart={(e) => onDragStart(e, service)}
      className={cn(
        'flex items-center gap-2 p-2 rounded-lg border transition-all',
        disabled
          ? 'opacity-50 cursor-not-allowed border-border-light bg-background-tertiary/30'
          : 'cursor-grab active:cursor-grabbing hover:shadow-md hover:border-sage-300 border-border bg-background'
      )}
    >
      <GripVertical className="h-4 w-4 text-foreground-muted flex-shrink-0" />

      <div
        className="w-2 h-8 rounded-full flex-shrink-0"
        style={{ backgroundColor: service.colorHex }}
      />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">
          {service.nameFr}
        </div>
        <div className="flex items-center gap-2 text-xs text-foreground-muted">
          <span>{service.durationMinutes} min</span>
          <span className="flex items-center gap-0.5">
            <Icon className="h-3 w-3" />
            {CLIENT_TYPE_LABELS[service.clientType]}
          </span>
        </div>
      </div>
    </div>
  )
}

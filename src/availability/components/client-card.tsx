// src/availability/components/client-card.tsx

import { X, Mail, Phone, User } from 'lucide-react'
import { differenceInYears, format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { cn } from '@/shared/lib/utils'
import type { Client } from '../types'

interface ClientCardProps {
  client: Client
  onRemove?: () => void
  compact?: boolean
  className?: string
}

// Get initials from client name
function getInitials(client: Client): string {
  return `${client.firstName.charAt(0)}${client.lastName.charAt(0)}`.toUpperCase()
}

export function ClientCard({ client, onRemove, compact = false, className }: ClientCardProps) {
  const birthDate = client.dateOfBirth ? new Date(client.dateOfBirth) : null
  const age = birthDate ? differenceInYears(new Date(), birthDate) : null
  const birthDateLabel = birthDate ? format(birthDate, 'd MMMM yyyy', { locale: fr }) : null

  if (compact) {
    return (
      <div className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-sage-100 text-sage-800 text-sm',
        className
      )}>
        <span className="font-medium">{client.firstName} {client.lastName}</span>
        {onRemove && (
          <button
            onClick={onRemove}
            className="ml-1 p-0.5 rounded-full hover:bg-sage-200 transition-colors"
            aria-label={`Retirer ${client.firstName}`}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={cn(
      'flex items-start gap-3 p-3 rounded-lg bg-background-secondary border border-border',
      className
    )}>
      {/* Avatar */}
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-sage-100 flex items-center justify-center">
        <span className="text-sm font-semibold text-sage-700">
          {getInitials(client)}
        </span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-foreground truncate">
          {client.firstName} {client.lastName}
        </div>
        {(age !== null || birthDateLabel) && (
          <div className="text-xs text-foreground-muted mt-0.5">
            {age !== null ? `${age} ans` : ''}
            {age !== null && birthDateLabel ? ' · ' : ''}
            {birthDateLabel ? `Né(e) le ${birthDateLabel}` : ''}
          </div>
        )}
        {client.email && (
          <div className="flex items-center gap-1.5 text-sm text-foreground-muted mt-0.5">
            <Mail className="h-3.5 w-3.5" />
            <span className="truncate">{client.email}</span>
          </div>
        )}
        {client.phone && (
          <div className="flex items-center gap-1.5 text-sm text-foreground-muted mt-0.5">
            <Phone className="h-3.5 w-3.5" />
            <span>{client.phone}</span>
          </div>
        )}
      </div>

      {/* Remove button */}
      {onRemove && (
        <button
          onClick={onRemove}
          className="flex-shrink-0 p-1.5 rounded-md text-foreground-muted hover:text-wine-600 hover:bg-wine-50 transition-colors"
          aria-label={`Retirer ${client.firstName}`}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

interface ClientPickerItemProps {
  client: Client
  isSelected: boolean
  canSelect: boolean
  onToggle: () => void
}

export function ClientPickerItem({ client, isSelected, canSelect, onToggle }: ClientPickerItemProps) {
  return (
    <button
      onClick={onToggle}
      disabled={!canSelect && !isSelected}
      className={cn(
        'w-full flex items-center gap-3 p-2 rounded-lg transition-all text-left',
        isSelected
          ? 'bg-sage-100 ring-1 ring-sage-300'
          : canSelect
          ? 'hover:bg-background-tertiary'
          : 'opacity-40 cursor-not-allowed'
      )}
    >
      {/* Avatar */}
      <div className={cn(
        'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
        isSelected ? 'bg-sage-200' : 'bg-background-tertiary'
      )}>
        {isSelected ? (
          <span className="text-xs font-semibold text-sage-700">✓</span>
        ) : (
          <User className="h-4 w-4 text-foreground-muted" />
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <span className={cn(
          'text-sm',
          isSelected ? 'font-medium text-sage-800' : 'text-foreground'
        )}>
          {client.firstName} {client.lastName}
        </span>
      </div>
    </button>
  )
}

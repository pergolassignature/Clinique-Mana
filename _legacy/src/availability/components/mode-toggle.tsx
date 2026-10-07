// src/availability/components/mode-toggle.tsx

import { cn } from '@/shared/lib/utils'
import type { CalendarMode } from '../types'

interface ModeToggleProps {
  mode: CalendarMode
  onModeChange: (mode: CalendarMode) => void
}

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <div className="flex rounded-lg bg-background-tertiary/50 p-1">
      <button
        onClick={() => onModeChange('availability')}
        className={cn(
          'px-3 py-1.5 text-sm font-medium rounded-md transition-all',
          mode === 'availability'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-foreground-muted hover:text-foreground'
        )}
      >
        Disponibilités
      </button>
      <button
        onClick={() => onModeChange('booking')}
        className={cn(
          'px-3 py-1.5 text-sm font-medium rounded-md transition-all',
          mode === 'booking'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-foreground-muted hover:text-foreground'
        )}
      >
        Rendez-vous
      </button>
    </div>
  )
}

// src/availability/components/collapsible-sidebar.tsx

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface CollapsibleSidebarProps {
  children: React.ReactNode
  collapsedContent?: React.ReactNode
}

export function CollapsibleSidebar({ children, collapsedContent }: CollapsibleSidebarProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  return (
    <aside
      className={cn(
        'relative border-r border-border bg-background-secondary/30 flex flex-col transition-all duration-200',
        isExpanded ? 'w-60' : 'w-14'
      )}
    >
      {/* Toggle button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="absolute -right-3 top-4 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background shadow-sm hover:bg-background-secondary transition-colors"
        aria-label={isExpanded ? 'Réduire le panneau' : 'Agrandir le panneau'}
      >
        {isExpanded ? (
          <ChevronLeft className="h-3.5 w-3.5 text-foreground-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-foreground-muted" />
        )}
      </button>

      {/* Content */}
      <div className={cn('flex-1 overflow-hidden', isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
        {children}
      </div>

      {/* Collapsed content (icons only) */}
      {!isExpanded && collapsedContent && (
        <div className="flex-1 flex flex-col items-center py-4 gap-2">
          {collapsedContent}
        </div>
      )}
    </aside>
  )
}

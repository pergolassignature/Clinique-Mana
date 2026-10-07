import { useState, useEffect } from 'react'
import { Search, X } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { useDemandeStatusCounts } from '../hooks'
import type { DemandesListFilters, DemandeStatus } from '../types'

interface DemandesFiltersProps {
  filters: DemandesListFilters
  onFiltersChange: (filters: DemandesListFilters) => void
}

type StatusFilterOption = DemandeStatus | 'all'

export function DemandesFilters({ filters, onFiltersChange }: DemandesFiltersProps) {
  const { data: counts } = useDemandeStatusCounts()
  const [searchValue, setSearchValue] = useState(filters.search || '')

  // Debounce search - intentionally only depends on searchValue to avoid loops
  useEffect(() => {
    const timer = setTimeout(() => {
      onFiltersChange({ ...filters, search: searchValue || undefined })
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue])

  const currentStatus: StatusFilterOption = filters.status || 'all'

  const handleStatusChange = (status: StatusFilterOption) => {
    onFiltersChange({
      ...filters,
      status: status === 'all' ? undefined : status,
    })
  }

  const hasActiveFilters = filters.status || filters.search

  const clearFilters = () => {
    setSearchValue('')
    onFiltersChange({})
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      {/* Status filter (segmented control) */}
      <div className="flex items-center gap-0.5 h-10 rounded-xl border border-border-light bg-background-tertiary/40 p-1">
        <StatusButton
          active={currentStatus === 'all'}
          onClick={() => handleStatusChange('all')}
          label={t('demandes.list.filters.all')}
          count={counts?.all}
        />
        <StatusButton
          active={currentStatus === 'toAnalyze'}
          onClick={() => handleStatusChange('toAnalyze')}
          label={t('demandes.list.filters.toAnalyze')}
          count={counts?.toAnalyze}
        />
        <StatusButton
          active={currentStatus === 'assigned'}
          onClick={() => handleStatusChange('assigned')}
          label={t('demandes.list.filters.assigned')}
          count={counts?.assigned}
        />
        <StatusButton
          active={currentStatus === 'closed'}
          onClick={() => handleStatusChange('closed')}
          label={t('demandes.list.filters.closed')}
          count={counts?.closed}
        />
      </div>

      {/* Search + Clear */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
          <Input
            value={searchValue}
            onChange={e => setSearchValue(e.target.value)}
            placeholder={t('demandes.list.searchPlaceholder')}
            className="pl-9 w-[240px] h-9"
          />
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9">
            <X className="h-4 w-4 mr-1" />
            {t('common.clearFilters')}
          </Button>
        )}
      </div>
    </div>
  )
}

interface StatusButtonProps {
  active: boolean
  onClick: () => void
  label: string
  count?: number
}

function StatusButton({ active, onClick, label, count }: StatusButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
        active
          ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
          : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
      )}
    >
      {label}
      {count !== undefined && (
        <span className="text-[10px] text-foreground-muted">({count})</span>
      )}
    </button>
  )
}

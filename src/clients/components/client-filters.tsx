import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Select } from '@/shared/ui/select'
import { Badge } from '@/shared/ui/badge'
import type { ClientsListFilters, ClientStatus } from '../types'
import { useClientTags, useProfessionals } from '../hooks'

interface ClientFiltersProps {
  filters: ClientsListFilters
  onFiltersChange: (filters: ClientsListFilters) => void
}

export function ClientFilters({ filters, onFiltersChange }: ClientFiltersProps) {
  const [searchValue, setSearchValue] = useState(filters.search || '')
  const { data: availableTags = [] } = useClientTags()
  const { data: professionals = [] } = useProfessionals()

  const handleSearchChange = (value: string) => {
    setSearchValue(value)
    // Debounce search
    const timeout = setTimeout(() => {
      onFiltersChange({ ...filters, search: value || undefined })
    }, 300)
    return () => clearTimeout(timeout)
  }

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    if (value === 'all') {
      const { status, ...rest } = filters
      onFiltersChange(rest)
    } else {
      onFiltersChange({ ...filters, status: value as ClientStatus })
    }
  }

  const handleProfessionalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    if (value === 'all') {
      const { primaryProfessionalId, ...rest } = filters
      onFiltersChange(rest)
    } else {
      onFiltersChange({ ...filters, primaryProfessionalId: value })
    }
  }

  const toggleTag = (tag: string) => {
    const currentTags = filters.tags || []
    if (currentTags.includes(tag)) {
      const newTags = currentTags.filter(t => t !== tag)
      onFiltersChange({ ...filters, tags: newTags.length > 0 ? newTags : undefined })
    } else {
      onFiltersChange({ ...filters, tags: [...currentTags, tag] })
    }
  }

  const clearFilters = () => {
    setSearchValue('')
    onFiltersChange({})
  }

  const hasActiveFilters = filters.search || filters.status || filters.primaryProfessionalId || (filters.tags && filters.tags.length > 0)

  return (
    <div className="space-y-3">
      {/* Main filter row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
          <Input
            placeholder={t('clients.list.searchPlaceholder')}
            value={searchValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
          {searchValue && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Status filter */}
        <Select
          value={filters.status || 'all'}
          onChange={handleStatusChange}
          className="w-[160px]"
        >
          <option value="all">{t('clients.list.filters.all')}</option>
          <option value="active">{t('clients.list.filters.active')}</option>
          <option value="archived">{t('clients.list.filters.archived')}</option>
        </Select>

        {/* Professional filter */}
        <Select
          value={filters.primaryProfessionalId || 'all'}
          onChange={handleProfessionalChange}
          className="w-[200px]"
        >
          <option value="all">{t('clients.list.filters.allProfessionals')}</option>
          {professionals.map(pro => (
            <option key={pro.id} value={pro.id}>
              {pro.displayName}
            </option>
          ))}
        </Select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="text-foreground-secondary"
          >
            <X className="h-4 w-4 mr-1" />
            {t('common.clearFilters')}
          </Button>
        )}
      </div>

      {/* Tags row */}
      {availableTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-foreground-secondary mr-1">
            {t('clients.list.filters.tags')}:
          </span>
          {availableTags.map(tag => (
            <Badge
              key={tag}
              variant="outline"
              className={cn(
                'cursor-pointer transition-colors',
                filters.tags?.includes(tag)
                  ? 'bg-sage-100 border-sage-300 text-sage-700'
                  : 'hover:bg-background-secondary'
              )}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

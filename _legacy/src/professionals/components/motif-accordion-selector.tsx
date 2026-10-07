// src/professionals/components/motif-accordion-selector.tsx
// Accordion-based motif selector for professional profile
// Replaces chip-based UI with categorized, searchable accordion

import { useState, useMemo, useCallback, useRef, useEffect, type KeyboardEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Folder,
} from 'lucide-react'
import * as Icons from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { StarToggle } from '@/shared/ui/star-toggle'
import { Skeleton } from '@/shared/ui/skeleton'
import { useMotifs, useMotifCategories, type DbMotifWithCategory } from '@/motifs'
import type { MotifCategory } from '@/motifs'

// =============================================================================
// TYPES
// =============================================================================

export interface MotifSelection {
  id: string
  key: string
}

export interface MotifAccordionSelectorProps {
  selectedMotifIds: string[]
  specializedMotifIds: string[]
  onMotifAdd: (motif: MotifSelection) => void
  onMotifRemove: (motif: MotifSelection) => void
  onSpecializationChange: (motifId: string, isSpecialized: boolean) => void
  disabled?: boolean
}

interface CategoryGroup {
  category: MotifCategory
  motifs: DbMotifWithCategory[]
  selectedCount: number
  specializedCount: number
}

// =============================================================================
// HELPER COMPONENTS
// =============================================================================

function CategoryIcon({ iconName, className }: { iconName: string | null; className?: string }) {
  if (!iconName) {
    return <Folder className={cn('h-4 w-4', className)} />
  }

  const IconComponent = Icons[iconName as keyof typeof Icons] as React.ComponentType<{ className?: string }> | undefined

  if (!IconComponent) {
    return <Folder className={cn('h-4 w-4', className)} />
  }

  return <IconComponent className={cn('h-4 w-4', className)} />
}

function MotifRow({
  motif,
  isSelected,
  isSpecialized,
  isHighlighted,
  onToggleSelection,
  onToggleSpecialization,
  disabled,
}: {
  motif: DbMotifWithCategory
  isSelected: boolean
  isSpecialized: boolean
  isHighlighted: boolean
  onToggleSelection: () => void
  onToggleSpecialization: () => void
  disabled?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
        'hover:bg-background-secondary/50',
        isHighlighted && 'bg-honey-50 ring-1 ring-honey-200'
      )}
    >
      {/* Checkbox */}
      <Checkbox
        checked={isSelected}
        onCheckedChange={onToggleSelection}
        disabled={disabled}
        aria-label={`Sélectionner ${motif.label}`}
      />

      {/* Label */}
      <span
        className={cn(
          'flex-1 text-sm select-none cursor-pointer',
          !isSelected && 'text-foreground-secondary'
        )}
        onClick={onToggleSelection}
      >
        {motif.label}
      </span>

      {/* Star toggle - only visible when selected */}
      <div className={cn('transition-opacity', isSelected ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
        <StarToggle
          isSpecialized={isSpecialized}
          onToggle={onToggleSpecialization}
          disabled={disabled || !isSelected}
          size="sm"
        />
      </div>
    </div>
  )
}

function AccordionHeader({
  category,
  isExpanded,
  onToggle,
  selectedCount,
  totalCount,
  specializedCount,
  tabIndex,
}: {
  category: MotifCategory
  isExpanded: boolean
  onToggle: () => void
  selectedCount: number
  totalCount: number
  specializedCount: number
  tabIndex?: number
}) {
  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggle()
    }
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      tabIndex={tabIndex}
      className={cn(
        'flex w-full items-center gap-3 px-3 py-3 rounded-lg transition-colors',
        'hover:bg-background-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/30',
        isExpanded && 'bg-background-secondary/50'
      )}
      aria-expanded={isExpanded}
      aria-controls={`accordion-content-${category.id}`}
    >
      {/* Chevron */}
      <div className="text-foreground-muted">
        {isExpanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </div>

      {/* Icon */}
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sage-100 text-sage-600">
        <CategoryIcon iconName={category.iconName} />
      </div>

      {/* Label and counts */}
      <div className="flex-1 text-left">
        <span className="text-sm font-medium">{category.label}</span>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 text-xs text-foreground-muted">
        <span>
          {selectedCount}/{totalCount}
          {specializedCount > 0 && (
            <span className="ml-1 text-amber-500">
              ({specializedCount} spec.)
            </span>
          )}
        </span>
      </div>
    </button>
  )
}

// =============================================================================
// LOADING STATE
// =============================================================================

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function MotifAccordionSelector({
  selectedMotifIds,
  specializedMotifIds,
  onMotifAdd,
  onMotifRemove,
  onSpecializationChange,
  disabled = false,
}: MotifAccordionSelectorProps) {
  const { motifs, isLoading: loadingMotifs } = useMotifs()
  const { data: categories, isLoading: loadingCategories } = useMotifCategories()

  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Convert ID sets to Sets for O(1) lookup
  const selectedIdSet = useMemo(() => new Set(selectedMotifIds), [selectedMotifIds])
  const specializedIdSet = useMemo(() => new Set(specializedMotifIds), [specializedMotifIds])

  // Build category groups with motifs
  const categoryGroups = useMemo<CategoryGroup[]>(() => {
    if (!categories || !motifs) return []

    // Create a map of category ID to motifs
    const motifsByCategory = new Map<string, DbMotifWithCategory[]>()

    // Group motifs by category
    for (const motif of motifs) {
      const categoryId = motif.category_id || 'uncategorized'
      const existing = motifsByCategory.get(categoryId) || []
      existing.push(motif)
      motifsByCategory.set(categoryId, existing)
    }

    // Build groups for each category
    const groups: CategoryGroup[] = []

    for (const category of categories) {
      const categoryMotifs = motifsByCategory.get(category.id) || []

      // Sort motifs alphabetically
      categoryMotifs.sort((a, b) => a.label.localeCompare(b.label, 'fr-CA'))

      // Count selected and specialized
      const selectedCount = categoryMotifs.filter((m) => selectedIdSet.has(m.id)).length
      const specializedCount = categoryMotifs.filter(
        (m) => selectedIdSet.has(m.id) && specializedIdSet.has(m.id)
      ).length

      if (categoryMotifs.length > 0) {
        groups.push({
          category,
          motifs: categoryMotifs,
          selectedCount,
          specializedCount,
        })
      }
    }

    // Handle uncategorized motifs
    const uncategorizedMotifs = motifsByCategory.get('uncategorized') || []
    if (uncategorizedMotifs.length > 0) {
      uncategorizedMotifs.sort((a, b) => a.label.localeCompare(b.label, 'fr-CA'))
      const selectedCount = uncategorizedMotifs.filter((m) => selectedIdSet.has(m.id)).length
      const specializedCount = uncategorizedMotifs.filter(
        (m) => selectedIdSet.has(m.id) && specializedIdSet.has(m.id)
      ).length

      groups.push({
        category: {
          id: 'uncategorized',
          key: 'uncategorized',
          label: 'Autres',
          description: null,
          iconName: null,
          displayOrder: 999,
          isActive: true,
        },
        motifs: uncategorizedMotifs,
        selectedCount,
        specializedCount,
      })
    }

    // Sort groups by display order
    groups.sort((a, b) => a.category.displayOrder - b.category.displayOrder)

    return groups
  }, [categories, motifs, selectedIdSet, specializedIdSet])

  // Filter motifs by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return categoryGroups

    const query = searchQuery.toLowerCase().trim()

    return categoryGroups
      .map((group) => ({
        ...group,
        motifs: group.motifs.filter((m) =>
          m.label.toLowerCase().includes(query)
        ),
      }))
      .filter((group) => group.motifs.length > 0)
  }, [categoryGroups, searchQuery])

  // IDs of motifs matching search (for highlighting)
  const matchingMotifIds = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>()

    const query = searchQuery.toLowerCase().trim()
    return new Set(
      motifs
        .filter((m) => m.label.toLowerCase().includes(query))
        .map((m) => m.id)
    )
  }, [motifs, searchQuery])

  // Auto-expand categories when searching
  useEffect(() => {
    if (searchQuery.trim()) {
      // Expand all categories that have matching motifs
      const categoryIds = filteredGroups.map((g) => g.category.id)
      setExpandedCategories(new Set(categoryIds))
    }
  }, [searchQuery, filteredGroups])

  // Handlers
  const handleToggleCategory = useCallback((categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(categoryId)) {
        next.delete(categoryId)
      } else {
        next.add(categoryId)
      }
      return next
    })
  }, [])

  const handleExpandAll = useCallback(() => {
    setExpandedCategories(new Set(categoryGroups.map((g) => g.category.id)))
  }, [categoryGroups])

  const handleCollapseAll = useCallback(() => {
    setExpandedCategories(new Set())
  }, [])

  // Build a map of motif ID to key for callbacks
  const motifIdToKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const motif of motifs) {
      map.set(motif.id, motif.key)
    }
    return map
  }, [motifs])

  const handleToggleMotifSelection = useCallback(
    (motifId: string) => {
      if (disabled) return

      const motifKey = motifIdToKey.get(motifId)
      if (!motifKey) return

      const isCurrentlySelected = selectedIdSet.has(motifId)

      if (isCurrentlySelected) {
        // Removing
        onMotifRemove({ id: motifId, key: motifKey })
      } else {
        // Adding
        onMotifAdd({ id: motifId, key: motifKey })
      }
    },
    [disabled, selectedIdSet, motifIdToKey, onMotifAdd, onMotifRemove]
  )

  const handleToggleSpecialization = useCallback(
    (motifId: string) => {
      if (disabled) return
      if (!selectedIdSet.has(motifId)) return

      const isCurrentlySpecialized = specializedIdSet.has(motifId)
      onSpecializationChange(motifId, !isCurrentlySpecialized)
    },
    [disabled, selectedIdSet, specializedIdSet, onSpecializationChange]
  )

  // Calculate totals
  const totalSelected = selectedMotifIds.length
  const totalSpecialized = specializedMotifIds.length

  // Loading state
  if (loadingMotifs || loadingCategories) {
    return <LoadingSkeleton />
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
        <Input
          ref={searchInputRef}
          type="text"
          placeholder="Rechercher un motif..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
          disabled={disabled}
        />
      </div>

      {/* Expand/Collapse controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleExpandAll}
            disabled={disabled}
            className="text-xs"
          >
            <ChevronsUpDown className="h-3.5 w-3.5 mr-1" />
            Tout développer
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCollapseAll}
            disabled={disabled}
            className="text-xs"
          >
            Tout réduire
          </Button>
        </div>
      </div>

      {/* Accordion sections */}
      <div className="space-y-1 rounded-xl border border-border bg-background overflow-hidden">
        {filteredGroups.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-foreground-muted">
            {searchQuery.trim()
              ? 'Aucun motif ne correspond à votre recherche.'
              : 'Aucun motif disponible.'}
          </div>
        ) : (
          filteredGroups.map((group, groupIndex) => {
            const isExpanded = expandedCategories.has(group.category.id)

            return (
              <div
                key={group.category.id}
                className={cn(
                  groupIndex > 0 && 'border-t border-border'
                )}
              >
                {/* Header */}
                <AccordionHeader
                  category={group.category}
                  isExpanded={isExpanded}
                  onToggle={() => handleToggleCategory(group.category.id)}
                  selectedCount={group.selectedCount}
                  totalCount={group.motifs.length}
                  specializedCount={group.specializedCount}
                  tabIndex={0}
                />

                {/* Content */}
                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      id={`accordion-content-${group.category.id}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="px-2 pb-3 pt-1">
                        <div className="space-y-0.5 rounded-lg bg-background-secondary/30 py-1">
                          {group.motifs.map((motif) => (
                            <MotifRow
                              key={motif.id}
                              motif={motif}
                              isSelected={selectedIdSet.has(motif.id)}
                              isSpecialized={specializedIdSet.has(motif.id)}
                              isHighlighted={matchingMotifIds.has(motif.id)}
                              onToggleSelection={() => handleToggleMotifSelection(motif.id)}
                              onToggleSpecialization={() => handleToggleSpecialization(motif.id)}
                              disabled={disabled}
                            />
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })
        )}
      </div>

      {/* Summary footer */}
      <div className="flex items-center justify-between rounded-lg bg-background-secondary/50 px-4 py-3 text-sm">
        <span className="text-foreground-secondary">
          {totalSelected} motif{totalSelected !== 1 ? 's' : ''} sélectionné{totalSelected !== 1 ? 's' : ''}
          {totalSpecialized > 0 && (
            <span className="ml-1 text-amber-600">
              ({totalSpecialized} spécialisé{totalSpecialized !== 1 ? 's' : ''})
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

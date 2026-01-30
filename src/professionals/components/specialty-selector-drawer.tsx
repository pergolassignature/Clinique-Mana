// src/professionals/components/specialty-selector-drawer.tsx
// Drawer for selecting specialties in professional profile

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, ChevronDown, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { t } from '@/i18n'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/shared/ui/sheet'
import { Input } from '@/shared/ui/input'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { StarToggle } from '@/shared/ui/star-toggle'
import type { Specialty, ProfessionalSpecialty } from '../types'

// Category labels for i18n
const categoryLabels: Record<string, string> = {
  therapy_type: 'professionals.portrait.specialties.categories.therapy_type',
  clientele: 'professionals.portrait.specialties.categories.clientele',
  issue: 'professionals.portrait.specialties.categories.issue',
  modality: 'professionals.portrait.specialties.categories.modality',
}

// Category display order
const categoryOrder: Record<string, number> = {
  therapy_type: 1,
  clientele: 2,
  issue: 3,
  modality: 4,
}

interface SpecialtySelectorDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  specialtiesByCategory: Record<string, Specialty[]>
  selectedSpecialties: ProfessionalSpecialty[]
  onAdd: (specialty: Specialty) => Promise<void>
  onRemove: (specialtyId: string) => Promise<void>
  onToggleSpecialization: (specialtyId: string, currentValue: boolean) => Promise<void>
  isAdding?: boolean
  isRemoving?: boolean
  isUpdating?: boolean
}

interface CategoryGroup {
  category: string
  label: string
  specialties: Specialty[]
  selectedCount: number
  specializedCount: number
}

function SpecialtyRow({
  specialty,
  isSelected,
  isSpecialized,
  isHighlighted,
  onToggleSelection,
  onToggleSpecialization,
  disabled,
}: {
  specialty: Specialty
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
        aria-label={`Sélectionner ${specialty.name_fr}`}
      />

      {/* Label */}
      <span
        className={cn(
          'flex-1 text-sm select-none cursor-pointer',
          !isSelected && 'text-foreground-secondary'
        )}
        onClick={onToggleSelection}
      >
        {specialty.name_fr}
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
  label,
  isExpanded,
  onToggle,
  selectedCount,
  totalCount,
  specializedCount,
}: {
  category: string
  label: string
  isExpanded: boolean
  onToggle: () => void
  selectedCount: number
  totalCount: number
  specializedCount: number
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex w-full items-center gap-3 px-3 py-3 rounded-lg transition-colors',
        'hover:bg-background-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/30',
        isExpanded && 'bg-background-secondary/50'
      )}
      aria-expanded={isExpanded}
      aria-controls={`specialty-accordion-${category}`}
    >
      {/* Chevron */}
      <div className="text-foreground-muted">
        {isExpanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
      </div>

      {/* Label */}
      <div className="flex-1 text-left">
        <span className="text-sm font-medium">{label}</span>
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

export function SpecialtySelectorDrawer({
  open,
  onOpenChange,
  specialtiesByCategory,
  selectedSpecialties,
  onAdd,
  onRemove,
  onToggleSpecialization,
  isAdding = false,
  isRemoving = false,
  isUpdating = false,
}: SpecialtySelectorDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  // Build sets for O(1) lookup
  const selectedIdSet = useMemo(
    () => new Set(selectedSpecialties.map((ps) => ps.specialty_id)),
    [selectedSpecialties]
  )
  const specializedIdSet = useMemo(
    () => new Set(selectedSpecialties.filter((ps) => ps.is_specialized).map((ps) => ps.specialty_id)),
    [selectedSpecialties]
  )

  // Build category groups
  const categoryGroups = useMemo<CategoryGroup[]>(() => {
    const groups: CategoryGroup[] = []

    for (const [category, specialties] of Object.entries(specialtiesByCategory)) {
      const sortedSpecialties = [...specialties].sort((a, b) =>
        a.name_fr.localeCompare(b.name_fr, 'fr-CA')
      )

      const selectedCount = sortedSpecialties.filter((s) => selectedIdSet.has(s.id)).length
      const specializedCount = sortedSpecialties.filter(
        (s) => selectedIdSet.has(s.id) && specializedIdSet.has(s.id)
      ).length

      groups.push({
        category,
        label: t(categoryLabels[category] as Parameters<typeof t>[0]),
        specialties: sortedSpecialties,
        selectedCount,
        specializedCount,
      })
    }

    // Sort by category order
    groups.sort((a, b) => (categoryOrder[a.category] || 99) - (categoryOrder[b.category] || 99))

    return groups
  }, [specialtiesByCategory, selectedIdSet, specializedIdSet])

  // Filter by search
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return categoryGroups

    const query = searchQuery.toLowerCase().trim()
    return categoryGroups
      .map((group) => ({
        ...group,
        specialties: group.specialties.filter((s) =>
          s.name_fr.toLowerCase().includes(query)
        ),
      }))
      .filter((group) => group.specialties.length > 0)
  }, [categoryGroups, searchQuery])

  // Matching IDs for highlighting
  const matchingIds = useMemo(() => {
    if (!searchQuery.trim()) return new Set<string>()
    const query = searchQuery.toLowerCase().trim()
    return new Set(
      Object.values(specialtiesByCategory)
        .flat()
        .filter((s) => s.name_fr.toLowerCase().includes(query))
        .map((s) => s.id)
    )
  }, [specialtiesByCategory, searchQuery])

  // Auto-expand on search
  useMemo(() => {
    if (searchQuery.trim()) {
      setExpandedCategories(new Set(filteredGroups.map((g) => g.category)))
    }
  }, [searchQuery, filteredGroups])

  const handleToggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const handleExpandAll = () => {
    setExpandedCategories(new Set(categoryGroups.map((g) => g.category)))
  }

  const handleCollapseAll = () => {
    setExpandedCategories(new Set())
  }

  const handleToggleSelection = async (specialty: Specialty) => {
    if (selectedIdSet.has(specialty.id)) {
      await onRemove(specialty.id)
    } else {
      await onAdd(specialty)
    }
  }

  const totalSelected = selectedSpecialties.length
  const totalSpecialized = selectedSpecialties.filter((ps) => ps.is_specialized).length
  const disabled = isAdding || isRemoving || isUpdating

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle>Spécialités</SheetTitle>
          <SheetDescription>
            Sélectionnez les spécialités pour ce professionnel. Utilisez l'étoile pour marquer les spécialisations.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
            <Input
              type="text"
              placeholder="Rechercher une spécialité..."
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
                  ? 'Aucune spécialité ne correspond à votre recherche.'
                  : 'Aucune spécialité disponible.'}
              </div>
            ) : (
              filteredGroups.map((group, groupIndex) => {
                const isExpanded = expandedCategories.has(group.category)

                return (
                  <div
                    key={group.category}
                    className={cn(groupIndex > 0 && 'border-t border-border')}
                  >
                    {/* Header */}
                    <AccordionHeader
                      category={group.category}
                      label={group.label}
                      isExpanded={isExpanded}
                      onToggle={() => handleToggleCategory(group.category)}
                      selectedCount={group.selectedCount}
                      totalCount={group.specialties.length}
                      specializedCount={group.specializedCount}
                    />

                    {/* Content */}
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          id={`specialty-accordion-${group.category}`}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: 'easeInOut' }}
                          className="overflow-hidden"
                        >
                          <div className="px-2 pb-3 pt-1">
                            <div className="space-y-0.5 rounded-lg bg-background-secondary/30 py-1">
                              {group.specialties.map((specialty) => (
                                <SpecialtyRow
                                  key={specialty.id}
                                  specialty={specialty}
                                  isSelected={selectedIdSet.has(specialty.id)}
                                  isSpecialized={specializedIdSet.has(specialty.id)}
                                  isHighlighted={matchingIds.has(specialty.id)}
                                  onToggleSelection={() => handleToggleSelection(specialty)}
                                  onToggleSpecialization={() =>
                                    onToggleSpecialization(specialty.id, specializedIdSet.has(specialty.id))
                                  }
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
              {totalSelected} spécialité{totalSelected !== 1 ? 's' : ''} sélectionnée{totalSelected !== 1 ? 's' : ''}
              {totalSpecialized > 0 && (
                <span className="ml-1 text-amber-600">
                  ({totalSpecialized} spécialisée{totalSpecialized !== 1 ? 's' : ''})
                </span>
              )}
            </span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

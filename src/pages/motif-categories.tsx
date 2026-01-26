// src/pages/motif-categories.tsx
// Admin settings page for managing motif categories

import { useState, useMemo, useCallback } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/components/empty-state'
import { toast } from '@/shared/hooks/use-toast'
import {
  useMotifCategories,
  useMotifCountInCategory,
  useCreateMotifCategory,
  useUpdateMotifCategory,
  useArchiveMotifCategory,
  useUnarchiveMotifCategory,
} from '@/motifs/hooks/use-motif-categories'
import { isCategoryKeyUnique } from '@/motifs/api'
import { CategoryCard } from '@/motifs/components/category-card'
import { CategoryEditorDialog } from '@/motifs/components/category-editor-dialog'
import { ArchiveCategoryDialog } from '@/motifs/components/archive-category-dialog'
import type { MotifCategory, MotifCategoryInput } from '@/motifs/types'

// Status filter modes
type StatusFilter = 'active' | 'archived' | 'all'

export function MotifCategoriesPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  // Editor dialog state
  const [editorOpen, setEditorOpen] = useState(false)
  const [categoryToEdit, setCategoryToEdit] = useState<MotifCategory | null>(null)

  // Archive dialog state
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false)
  const [categoryToArchive, setCategoryToArchive] = useState<MotifCategory | null>(null)

  // Fetch all categories (including inactive for management view)
  const { data: allCategories = [], isLoading, error, refetch } = useMotifCategories({ includeInactive: true })

  // Mutations
  const createMutation = useCreateMotifCategory()
  const updateMutation = useUpdateMotifCategory()
  const archiveMutation = useArchiveMotifCategory()
  const unarchiveMutation = useUnarchiveMotifCategory()

  // Count motifs in category being archived (for warning)
  const { data: archiveMotifCount } = useMotifCountInCategory(categoryToArchive?.id ?? '')

  // Filter by status
  const filteredCategories = useMemo(() => {
    switch (statusFilter) {
      case 'active':
        return allCategories.filter((c) => c.isActive)
      case 'archived':
        return allCategories.filter((c) => !c.isActive)
      case 'all':
      default:
        return allCategories
    }
  }, [allCategories, statusFilter])

  // Sort by display order
  const sortedCategories = useMemo(() => {
    return [...filteredCategories].sort((a, b) => a.displayOrder - b.displayOrder)
  }, [filteredCategories])

  // Counts for filter badges
  const activeCount = useMemo(() => allCategories.filter((c) => c.isActive).length, [allCategories])
  const archivedCount = useMemo(() => allCategories.filter((c) => !c.isActive).length, [allCategories])

  const hasCategories = allCategories.length > 0
  const hasResults = filteredCategories.length > 0

  // Get motif count for a category (mocked for now - would need batch query)
  const getMotifCount = useCallback((_categoryId: string): number => {
    // In a real implementation, this would come from a batch query
    // For now, returning 0 - the individual count hook is used for archive warning
    return 0
  }, [])

  // Handle create button click
  const handleCreateClick = useCallback(() => {
    setCategoryToEdit(null)
    setEditorOpen(true)
  }, [])

  // Handle edit action
  const handleEditClick = useCallback((category: MotifCategory) => {
    setCategoryToEdit(category)
    setEditorOpen(true)
  }, [])

  // Handle archive action
  const handleArchiveClick = useCallback((category: MotifCategory) => {
    setCategoryToArchive(category)
    setArchiveDialogOpen(true)
  }, [])

  // Handle archive confirmation
  const handleArchiveConfirm = useCallback(async () => {
    if (!categoryToArchive) return

    try {
      await archiveMutation.mutateAsync(categoryToArchive.id)
      setArchiveDialogOpen(false)
      setCategoryToArchive(null)
    } catch {
      // Error handled by mutation
    }
  }, [categoryToArchive, archiveMutation])

  // Handle restore action
  const handleRestore = useCallback(async (category: MotifCategory) => {
    try {
      await unarchiveMutation.mutateAsync(category.id)
    } catch {
      // Error handled by mutation
    }
  }, [unarchiveMutation])

  // Handle editor submit (create or update)
  const handleEditorSubmit = useCallback(async (input: MotifCategoryInput) => {
    if (categoryToEdit) {
      // Update existing
      await updateMutation.mutateAsync({ id: categoryToEdit.id, input })
    } else {
      // Create new
      await createMutation.mutateAsync(input)
    }
    setEditorOpen(false)
    setCategoryToEdit(null)
  }, [categoryToEdit, createMutation, updateMutation])

  // Validate key uniqueness
  const validateKey = useCallback(async (key: string, excludeId?: string): Promise<boolean> => {
    try {
      return await isCategoryKeyUnique(key, excludeId)
    } catch {
      toast({
        title: 'Erreur',
        description: 'Impossible de verifier la cle.',
        variant: 'error',
      })
      return false
    }
  }, [])

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-sage-500" />
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <EmptyState
          title="Erreur de chargement"
          description={`Impossible de charger les categories: ${error.message}`}
          action={
            <Button onClick={() => refetch()}>
              Reessayer
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Action button */}
      <div className="flex justify-end">
        <Button onClick={handleCreateClick}>
          <Plus className="h-4 w-4" />
          Nouvelle categorie
        </Button>
      </div>

      {/* Info banner */}
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <p className="text-sm text-sky-800">
          Les categories permettent de regrouper les motifs de consultation par sphere de vie.
          Elles facilitent la navigation et l'organisation des motifs.
        </p>
      </div>

      {/* Status filter (segmented control) */}
      <div className="flex items-center gap-0.5 h-10 rounded-xl border border-border-light bg-background-tertiary/40 p-1 w-fit">
        <button
          type="button"
          onClick={() => setStatusFilter('active')}
          className={cn(
            'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
            statusFilter === 'active'
              ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
              : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
          )}
        >
          Actives
          <span className="text-[10px] text-foreground-muted">({activeCount})</span>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('archived')}
          className={cn(
            'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
            statusFilter === 'archived'
              ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
              : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
          )}
        >
          Archivees
          <span className="text-[10px] text-foreground-muted">({archivedCount})</span>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={cn(
            'flex items-center gap-1.5 h-full px-3 rounded-lg text-xs font-medium transition-colors',
            statusFilter === 'all'
              ? 'bg-sage-100/70 border border-sage-200/60 text-sage-700'
              : 'text-foreground-secondary hover:text-foreground hover:bg-sage-50/50'
          )}
        >
          Toutes
        </button>
      </div>

      {/* Content */}
      {!hasCategories ? (
        <EmptyState
          title="Aucune categorie"
          description="Commencez par creer des categories pour organiser vos motifs de consultation."
          action={
            <Button onClick={handleCreateClick}>
              <Plus className="h-4 w-4" />
              Nouvelle categorie
            </Button>
          }
        />
      ) : !hasResults ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-foreground-muted">
            {statusFilter === 'archived'
              ? 'Aucune categorie archivee'
              : 'Aucune categorie active'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sortedCategories.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              motifCount={getMotifCount(category.id)}
              onEdit={() => handleEditClick(category)}
              onArchive={() => handleArchiveClick(category)}
              onRestore={() => handleRestore(category)}
            />
          ))}
        </div>
      )}

      {/* Count footer */}
      {hasResults && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs text-foreground-muted text-center">
            {filteredCategories.length} categorie{filteredCategories.length !== 1 ? 's' : ''}{' '}
            {statusFilter === 'archived' ? 'archivee' : statusFilter === 'active' ? 'active' : 'au total'}
            {filteredCategories.length !== 1 && statusFilter !== 'all' ? 's' : ''}
          </p>
        </div>
      )}

      {/* Editor dialog */}
      <CategoryEditorDialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) setCategoryToEdit(null)
        }}
        category={categoryToEdit}
        onSubmit={handleEditorSubmit}
        validateKey={validateKey}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
      />

      {/* Archive confirmation dialog */}
      {categoryToArchive && (
        <ArchiveCategoryDialog
          open={archiveDialogOpen}
          onOpenChange={(open) => {
            setArchiveDialogOpen(open)
            if (!open) setCategoryToArchive(null)
          }}
          categoryLabel={categoryToArchive.label}
          motifCount={archiveMotifCount ?? 0}
          onConfirm={handleArchiveConfirm}
          isLoading={archiveMutation.isPending}
        />
      )}
    </div>
  )
}

// src/motifs/components/categories-manager-drawer.tsx
// Drawer for managing motif categories from within the Motifs page

import { useState, useMemo, useCallback } from 'react'
import { Plus, Loader2, Pencil, FolderTree } from 'lucide-react'
import * as Icons from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/shared/ui/sheet'
import { toast } from '@/shared/hooks/use-toast'
import {
  useMotifCategories,
  useCreateMotifCategory,
  useUpdateMotifCategory,
} from '../hooks/use-motif-categories'
import { isCategoryKeyUnique } from '../api'
import { CategoryEditorDialog } from './category-editor-dialog'
import type { MotifCategory, MotifCategoryInput } from '../types'

interface CategoriesManagerDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  motifCountByCategory: Record<string, number>
}

export function CategoriesManagerDrawer({
  open,
  onOpenChange,
  motifCountByCategory,
}: CategoriesManagerDrawerProps) {
  // Editor dialog state
  const [editorOpen, setEditorOpen] = useState(false)
  const [categoryToEdit, setCategoryToEdit] = useState<MotifCategory | null>(null)

  // Fetch active categories only
  const { data: categories = [], isLoading } = useMotifCategories()

  // Mutations
  const createMutation = useCreateMotifCategory()
  const updateMutation = useUpdateMotifCategory()

  // Sort categories by display order
  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => a.displayOrder - b.displayOrder)
  }, [categories])

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

  // Handle editor submit (create or update)
  const handleEditorSubmit = useCallback(async (input: MotifCategoryInput) => {
    if (categoryToEdit) {
      await updateMutation.mutateAsync({ id: categoryToEdit.id, input })
    } else {
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
        description: 'Impossible de vérifier la clé.',
        variant: 'error',
      })
      return false
    }
  }, [])

  // Get icon component
  const getIconComponent = (iconName: string | null) => {
    if (!iconName) return FolderTree
    const IconComponent = Icons[iconName as keyof typeof Icons] as React.ComponentType<{ className?: string }> | undefined
    return IconComponent ?? FolderTree
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle className="flex items-center gap-2">
              <FolderTree className="h-5 w-5 text-sage-600" />
              Catégories de motifs
            </SheetTitle>
            <SheetDescription>
              Organisez les motifs en catégories pour faciliter la navigation.
            </SheetDescription>
          </SheetHeader>

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 py-4 border-b">
            <Button size="sm" onClick={handleCreateClick}>
              <Plus className="h-4 w-4" />
              Nouvelle catégorie
            </Button>
            <span className="text-xs text-foreground-muted">
              {sortedCategories.length} catégorie{sortedCategories.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-sage-500" />
            </div>
          ) : sortedCategories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FolderTree className="h-8 w-8 text-foreground-muted mb-3" />
              <p className="text-sm text-foreground-muted">
                Aucune catégorie
              </p>
              <Button size="sm" variant="outline" onClick={handleCreateClick} className="mt-3">
                <Plus className="h-4 w-4" />
                Créer une catégorie
              </Button>
            </div>
          ) : (
            <div className="space-y-2 py-4">
              {sortedCategories.map((category) => {
                const IconComponent = getIconComponent(category.iconName)
                const motifCount = motifCountByCategory[category.id] ?? 0

                return (
                  <div
                    key={category.id}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-background hover:bg-sage-50/50 transition-colors"
                  >
                    {/* Icon */}
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sage-100 text-sage-600">
                      <IconComponent className="h-4 w-4" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm truncate block">{category.label}</span>
                      <p className="text-xs text-foreground-muted truncate">
                        {motifCount} motif{motifCount !== 1 ? 's' : ''}
                        {category.description && ` · ${category.description}`}
                      </p>
                    </div>

                    {/* Edit button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => handleEditClick(category)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </SheetContent>
      </Sheet>

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
    </>
  )
}

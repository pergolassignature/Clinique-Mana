// src/motifs/components/archive-category-dialog.tsx
// Confirmation dialog for archiving a motif category

import { Loader2, FolderOpen } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'

interface ArchiveCategoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  categoryLabel: string
  motifCount: number
  onConfirm: () => void
  isLoading: boolean
}

export function ArchiveCategoryDialog({
  open,
  onOpenChange,
  categoryLabel,
  motifCount,
  onConfirm,
  isLoading,
}: ArchiveCategoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Archiver cette categorie?</DialogTitle>
          <DialogDescription className="pt-2">
            <span className="font-medium text-foreground">{categoryLabel}</span>
          </DialogDescription>
        </DialogHeader>

        {motifCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-honey-200 bg-honey-50 p-3">
            <FolderOpen className="h-4 w-4 text-honey-600 shrink-0" />
            <p className="text-sm text-honey-800">
              Cette categorie contient {motifCount} motif{motifCount > 1 ? 's' : ''}.
              L'archivage ne supprimera pas les motifs associes.
            </p>
          </div>
        )}

        <p className="text-sm text-foreground-secondary">
          La categorie ne sera plus visible dans les listes, mais les motifs qui y sont associes resteront accessibles.
        </p>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Annuler
          </Button>
          <Button
            variant="default"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Archiver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

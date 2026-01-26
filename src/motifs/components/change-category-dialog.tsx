import { useState, useEffect } from 'react'
import { t } from '@/i18n'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Button } from '@/shared/ui/button'
import { Select } from '@/shared/ui/select'
import { Loader2 } from 'lucide-react'
import type { MotifCategory } from '../types'

interface ChangeCategoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  motifLabel: string
  currentCategoryId: string | null
  categories: MotifCategory[]
  onConfirm: (categoryId: string | null) => Promise<{ success: boolean }>
  onSuccess?: () => void
}

const NO_CATEGORY_VALUE = ''

export function ChangeCategoryDialog({
  open,
  onOpenChange,
  motifLabel,
  currentCategoryId,
  categories,
  onConfirm,
  onSuccess,
}: ChangeCategoryDialogProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    currentCategoryId || NO_CATEGORY_VALUE
  )
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset selection when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedCategoryId(currentCategoryId || NO_CATEGORY_VALUE)
    }
  }, [open, currentCategoryId])

  const handleConfirm = async () => {
    setIsSubmitting(true)
    const categoryId = selectedCategoryId === NO_CATEGORY_VALUE ? null : selectedCategoryId
    const result = await onConfirm(categoryId)
    setIsSubmitting(false)

    if (result.success) {
      onOpenChange(false)
      onSuccess?.()
    }
  }

  const activeCategories = categories.filter((c) => c.isActive)

  // Build description with the motif label
  const description = t('pages.motifs.changeCategory.description').replace('{{label}}', motifLabel)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('pages.motifs.changeCategory.title')}</DialogTitle>
          <DialogDescription>
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Select
            value={selectedCategoryId}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
            className="w-full"
          >
            <option value={NO_CATEGORY_VALUE}>
              {t('pages.motifs.changeCategory.noCategory')}
            </option>
            {activeCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </Select>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSubmitting
              ? t('common.saving')
              : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

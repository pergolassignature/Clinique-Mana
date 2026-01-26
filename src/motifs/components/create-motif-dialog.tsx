import { useState, useEffect, useCallback } from 'react'
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Select } from '@/shared/ui/select'
import { Label } from '@/shared/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { generateKeyFromLabel } from '../hooks/use-motif-mutations'
import type { MotifCategory } from '../types'

interface CreateMotifDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: { key: string; label: string; categoryId?: string | null }) => Promise<{
    success: boolean
    error?: Error
    motif?: { id: string; key: string; label: string }
  }>
  validateKey: (key: string) => Promise<{
    isValid: boolean
    isUnique: boolean
    error?: string
  }>
  categories?: MotifCategory[]
  onSuccess?: () => void
}

export function CreateMotifDialog({
  open,
  onOpenChange,
  onSubmit,
  validateKey,
  categories = [],
  onSuccess,
}: CreateMotifDialogProps) {
  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [showKeyField, setShowKeyField] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errors, setErrors] = useState<{ label?: string; key?: string }>({})

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setLabel('')
      setKey('')
      setCategoryId('')
      setShowKeyField(false)
      setErrors({})
    }
  }, [open])

  // Auto-generate key from label when label changes (if key field is not shown)
  useEffect(() => {
    if (!showKeyField && label) {
      setKey(generateKeyFromLabel(label))
    }
  }, [label, showKeyField])

  const validateForm = useCallback(async (): Promise<boolean> => {
    const newErrors: { label?: string; key?: string } = {}

    // Validate label
    if (!label.trim()) {
      newErrors.label = t('pages.motifs.create.validation.labelRequired')
    }

    // Validate key
    if (!key.trim()) {
      newErrors.key = t('pages.motifs.create.validation.keyRequired')
    } else {
      const keyValidation = await validateKey(key)
      if (!keyValidation.isValid) {
        newErrors.key = t('pages.motifs.create.validation.keyInvalid')
      } else if (!keyValidation.isUnique) {
        newErrors.key = t('pages.motifs.create.validation.keyExists')
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [label, key, validateKey])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const isValid = await validateForm()
    if (!isValid) return

    setIsSubmitting(true)
    const result = await onSubmit({
      key: key.trim(),
      label: label.trim(),
      categoryId: categoryId || null,
    })
    setIsSubmitting(false)

    if (result.success) {
      onOpenChange(false)
      onSuccess?.()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pages.motifs.create.title')}</DialogTitle>
          <DialogDescription>
            {t('pages.motifs.create.subtitle')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Label field */}
          <div className="space-y-2">
            <label
              htmlFor="motif-label"
              className="text-sm font-medium text-foreground"
            >
              {t('pages.motifs.create.labelField')}
            </label>
            <Input
              id="motif-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('pages.motifs.create.labelPlaceholder')}
              disabled={isSubmitting}
              autoFocus
            />
            {errors.label ? (
              <p className="text-xs text-red-600">{errors.label}</p>
            ) : (
              <p className="text-xs text-foreground-muted">
                {t('pages.motifs.create.labelHelper')}
              </p>
            )}
          </div>

          {/* Key field (collapsible) */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowKeyField(!showKeyField)}
              className="flex items-center gap-1 text-xs font-medium text-sage-600 hover:text-sage-700 transition-colors"
            >
              {showKeyField ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {t('pages.motifs.create.keyAdvanced')}
            </button>

            {showKeyField && (
              <div className="space-y-2 pt-1">
                <label
                  htmlFor="motif-key"
                  className="text-sm font-medium text-foreground"
                >
                  {t('pages.motifs.create.keyField')}
                </label>
                <Input
                  id="motif-key"
                  value={key}
                  onChange={(e) => setKey(e.target.value.toLowerCase())}
                  placeholder={t('pages.motifs.create.keyPlaceholder')}
                  disabled={isSubmitting}
                  className="font-mono text-sm"
                />
                {errors.key ? (
                  <p className="text-xs text-red-600">{errors.key}</p>
                ) : (
                  <p className="text-xs text-foreground-muted">
                    {t('pages.motifs.create.keyHelper')}
                  </p>
                )}
              </div>
            )}

            {/* Show generated key preview when collapsed */}
            {!showKeyField && key && (
              <p className="text-xs text-foreground-muted font-mono">
                Clé: {key}
              </p>
            )}
          </div>

          {/* Category field */}
          {categories.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="motif-category">
                {t('pages.motifs.create.categoryField')}
              </Label>
              <Select
                id="motif-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={isSubmitting}
              >
                <option value="">{t('pages.motifs.create.categoryPlaceholder')}</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-foreground-muted">
                {t('pages.motifs.create.categoryHelper')}
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('pages.motifs.create.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || !label.trim()}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSubmitting
                ? t('pages.motifs.create.submitting')
                : t('pages.motifs.create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

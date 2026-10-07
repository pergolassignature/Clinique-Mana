// src/motifs/components/category-editor-dialog.tsx
// Dialog for creating and editing motif categories

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import * as Icons from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import type { MotifCategory, MotifCategoryInput } from '../types'

// Available Lucide icons for categories
const AVAILABLE_ICONS = [
  'Brain',
  'Users',
  'AlertTriangle',
  'Briefcase',
  'GraduationCap',
  'Fingerprint',
  'Shield',
  'Leaf',
  'Heart',
  'Activity',
  'Star',
  'Zap',
  'Cloud',
  'Sun',
  'Moon',
  'Home',
  'Target',
  'Compass',
  'Sparkles',
  'MessageCircle',
] as const

interface CategoryEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  category?: MotifCategory | null // null for create mode
  onSubmit: (input: MotifCategoryInput) => Promise<void>
  validateKey: (key: string, excludeId?: string) => Promise<boolean>
  isSubmitting: boolean
}

// Generate key from label (snake_case)
function generateKeyFromLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9\s]/g, '') // Remove special chars
    .replace(/\s+/g, '_') // Spaces to underscores
    .replace(/_+/g, '_') // Multiple underscores to single
    .replace(/^_|_$/g, '') // Trim underscores
}

export function CategoryEditorDialog({
  open,
  onOpenChange,
  category,
  onSubmit,
  validateKey,
  isSubmitting,
}: CategoryEditorDialogProps) {
  const isEditMode = !!category

  // Form state
  const [label, setLabel] = useState('')
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const [iconName, setIconName] = useState<string>('')
  const [showKeyField, setShowKeyField] = useState(false)
  const [errors, setErrors] = useState<{ label?: string; key?: string }>({})

  // Reset form when dialog opens/closes or category changes
  useEffect(() => {
    if (open) {
      if (category) {
        // Edit mode: populate from existing category
        setLabel(category.label)
        setKey(category.key)
        setDescription(category.description || '')
        setIconName(category.iconName || '')
        setShowKeyField(true) // Always show key in edit mode
      } else {
        // Create mode: reset form
        setLabel('')
        setKey('')
        setDescription('')
        setIconName('')
        setShowKeyField(false)
      }
      setErrors({})
    }
  }, [open, category])

  // Auto-generate key from label when label changes (if key field is not shown and not in edit mode)
  useEffect(() => {
    if (!showKeyField && !isEditMode && label) {
      setKey(generateKeyFromLabel(label))
    }
  }, [label, showKeyField, isEditMode])

  const validateForm = useCallback(async (): Promise<boolean> => {
    const newErrors: { label?: string; key?: string } = {}

    // Validate label
    if (!label.trim()) {
      newErrors.label = 'Le libelle est requis.'
    }

    // Validate key
    if (!key.trim()) {
      newErrors.key = 'La cle est requise.'
    } else if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      newErrors.key = 'La cle doit commencer par une lettre et ne contenir que des lettres minuscules, chiffres et underscores.'
    } else {
      // Check uniqueness
      const isUnique = await validateKey(key, category?.id)
      if (!isUnique) {
        newErrors.key = 'Cette cle existe deja.'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [label, key, validateKey, category?.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const isValid = await validateForm()
    if (!isValid) return

    await onSubmit({
      key: key.trim(),
      label: label.trim(),
      description: description.trim() || undefined,
      iconName: iconName || undefined,
    })
  }

  // Memoized icon options for the dropdown
  const iconOptions = useMemo(() => {
    return AVAILABLE_ICONS.map((name) => ({
      name,
      Icon: Icons[name] as React.ComponentType<{ className?: string }>,
    }))
  }, [])

  // Get the selected icon component for preview
  const SelectedIconComponent = iconName
    ? (Icons[iconName as keyof typeof Icons] as React.ComponentType<{ className?: string }> | undefined)
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? 'Modifier la categorie' : 'Creer une categorie'}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Modifiez les informations de cette categorie de motifs.'
              : 'Cette categorie servira a regrouper des motifs de consultation.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Label field */}
          <div className="space-y-2">
            <Label htmlFor="category-label">Libelle</Label>
            <Input
              id="category-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex: Vie interieure"
              disabled={isSubmitting}
              autoFocus
            />
            {errors.label ? (
              <p className="text-xs text-red-600">{errors.label}</p>
            ) : (
              <p className="text-xs text-foreground-muted">
                Nom affiche dans l'interface.
              </p>
            )}
          </div>

          {/* Key field (collapsible in create mode) */}
          <div className="space-y-2">
            {!isEditMode && (
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
                Modifier la cle
              </button>
            )}

            {(showKeyField || isEditMode) && (
              <div className="space-y-2 pt-1">
                <Label htmlFor="category-key">Cle technique</Label>
                <Input
                  id="category-key"
                  value={key}
                  onChange={(e) => setKey(e.target.value.toLowerCase())}
                  placeholder="Ex: vie_interieure"
                  disabled={isSubmitting}
                  className="font-mono text-sm"
                />
                {errors.key ? (
                  <p className="text-xs text-red-600">{errors.key}</p>
                ) : (
                  <p className="text-xs text-foreground-muted">
                    Identifiant unique (minuscules et underscores).
                  </p>
                )}
              </div>
            )}

            {/* Show generated key preview when collapsed */}
            {!showKeyField && !isEditMode && key && (
              <p className="text-xs text-foreground-muted font-mono">
                Cle: {key}
              </p>
            )}
          </div>

          {/* Description field */}
          <div className="space-y-2">
            <Label htmlFor="category-description">Description (optionnelle)</Label>
            <Textarea
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Breve description de cette categorie..."
              disabled={isSubmitting}
              rows={2}
            />
            <p className="text-xs text-foreground-muted">
              Affichee pour aider a comprendre le regroupement.
            </p>
          </div>

          {/* Icon selector */}
          <div className="space-y-2">
            <Label htmlFor="category-icon">Icone (optionnelle)</Label>
            <div className="flex items-center gap-2">
              {/* Icon preview */}
              {SelectedIconComponent && (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sage-100 text-sage-600">
                  <SelectedIconComponent className="h-5 w-5" />
                </div>
              )}
              <Select
                id="category-icon"
                value={iconName}
                onChange={(e) => setIconName(e.target.value)}
                disabled={isSubmitting}
                placeholder="Choisir une icone..."
              >
                <option value="">Aucune icone</option>
                {iconOptions.map(({ name }) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-xs text-foreground-muted">
              Icone affichee a cote du libelle.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={isSubmitting || !label.trim()}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSubmitting
                ? isEditMode
                  ? 'Enregistrement...'
                  : 'Creation...'
                : isEditMode
                  ? 'Enregistrer'
                  : 'Creer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

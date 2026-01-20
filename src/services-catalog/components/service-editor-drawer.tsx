// src/services-catalog/components/service-editor-drawer.tsx
// NOTE: Simplified for v2 schema. Full editor with database support coming in Phase 2.

import { useState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
  Dialog,
  DialogContent,
} from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/select'
import type { Service, ServiceFormData, PricingModel } from '../types'
import { PRICING_MODELS, PRICING_MODEL_LABELS } from '../constants/pricing-models'

interface ServiceEditorDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  service?: Service | null  // null = create mode
  onSubmit: (data: ServiceFormData) => Promise<{ success: boolean; error?: Error }>
  onSuccess?: () => void
}

interface FormErrors {
  name?: string
  duration?: string
}

export function ServiceEditorDrawer({
  open,
  onOpenChange,
  service,
  onSubmit,
  onSuccess,
}: ServiceEditorDrawerProps) {
  const isEditMode = !!service

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState('')
  const [pricingModel, setPricingModel] = useState<PricingModel>('fixed')
  const [colorHex, setColorHex] = useState('')
  const [requiresConsent, setRequiresConsent] = useState(false)

  // UI state
  const [errors, setErrors] = useState<FormErrors>({})
  const [isLoading, setIsLoading] = useState(false)

  // Initialize form when service changes
  useEffect(() => {
    if (service) {
      setName(service.name)
      setDescription(service.description || '')
      setDuration(service.duration?.toString() || '')
      setPricingModel(service.pricingModel)
      setColorHex(service.colorHex || '')
      setRequiresConsent(service.requiresConsent)
    } else {
      resetForm()
    }
  }, [service, open])

  const resetForm = () => {
    setName('')
    setDescription('')
    setDuration('')
    setPricingModel('fixed')
    setColorHex('')
    setRequiresConsent(false)
    setErrors({})
  }

  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    if (!name.trim()) {
      newErrors.name = t('pages.services.validation.nameRequired')
    }

    if (duration) {
      const durationNum = parseInt(duration, 10)
      if (isNaN(durationNum) || durationNum < 0) {
        newErrors.duration = t('pages.services.validation.durationMin')
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return

    setIsLoading(true)

    const formData: ServiceFormData = {
      name: name.trim(),
      description: description.trim(),
      pricingModel,
      duration: duration ? parseInt(duration, 10) : null,
      displayOrder: service?.displayOrder || 0,
      colorHex: colorHex || null,
      requiresConsent,
    }

    const result = await onSubmit(formData)
    setIsLoading(false)

    if (result.success) {
      onOpenChange(false)
      resetForm()
      onSuccess?.()
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    resetForm()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="fixed right-0 top-0 h-full max-h-full w-full max-w-lg translate-x-0 translate-y-0 rounded-none rounded-l-2xl border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right data-[state=closed]:duration-300 data-[state=open]:duration-300"
        style={{
          left: 'auto',
          top: 0,
          transform: 'none',
        }}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {isEditMode ? t('pages.services.edit.title') : t('pages.services.create.title')}
              </h2>
              {!isEditMode && (
                <p className="text-sm text-foreground-muted mt-0.5">
                  {t('pages.services.create.subtitle')}
                </p>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={handleClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t('pages.services.create.fields.name')}
                <span className="text-wine-500 ml-0.5">*</span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('pages.services.create.fields.namePlaceholder')}
                className={cn(errors.name && 'border-wine-300')}
              />
              {errors.name ? (
                <p className="text-xs text-wine-600">{errors.name}</p>
              ) : (
                <p className="text-xs text-foreground-muted">
                  {t('pages.services.create.fields.nameHelper')}
                </p>
              )}
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t('pages.services.create.fields.description')}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('pages.services.create.fields.descriptionPlaceholder')}
                rows={3}
                className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm placeholder:text-foreground-muted focus:border-sage-300 focus:outline-none focus:ring-2 focus:ring-sage-500/20"
              />
              <p className="text-xs text-foreground-muted">
                {t('pages.services.create.fields.descriptionHelper')}
              </p>
            </div>

            {/* Duration */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {t('pages.services.create.fields.duration')}
              </label>
              <Input
                type="number"
                min="0"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder={t('pages.services.create.fields.durationPlaceholder')}
                className={cn(errors.duration && 'border-wine-300')}
              />
              {errors.duration && (
                <p className="text-xs text-wine-600">{errors.duration}</p>
              )}
            </div>

            {/* Pricing Model */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Modèle de tarification
              </label>
              <Select
                value={pricingModel}
                onChange={(e) => setPricingModel(e.target.value as PricingModel)}
              >
                {PRICING_MODELS.map((model) => (
                  <option key={model} value={model}>
                    {t(PRICING_MODEL_LABELS[model] as Parameters<typeof t>[0])}
                  </option>
                ))}
              </Select>
            </div>

            {/* Color */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Couleur (calendrier)
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                  placeholder="#7FAE9D"
                  className="flex-1"
                />
                {colorHex && (
                  <div
                    className="h-10 w-10 rounded-lg border border-border"
                    style={{ backgroundColor: colorHex }}
                  />
                )}
              </div>
            </div>

            {/* Consent checkbox */}
            <div className="flex items-center justify-between rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Nécessite un consentement
                </p>
                <p className="text-xs text-foreground-muted mt-0.5">
                  Le client devra signer un formulaire de consentement.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={requiresConsent}
                onClick={() => setRequiresConsent(!requiresConsent)}
                className={cn(
                  'relative h-6 w-11 rounded-full transition-colors',
                  requiresConsent ? 'bg-sage-500' : 'bg-background-tertiary'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                    requiresConsent && 'translate-x-5'
                  )}
                />
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-3 border-t border-border px-6 py-4">
            <Button variant="outline" className="flex-1" onClick={handleClose}>
              {t('pages.services.create.cancel')}
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditMode ? t('pages.services.edit.submit') : t('pages.services.create.submit')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

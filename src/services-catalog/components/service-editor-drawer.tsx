// src/services-catalog/components/service-editor-drawer.tsx

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/select'
import { useToast } from '@/shared/hooks/use-toast'
import type { Service, ServiceFormData, PricingModel } from '../types'
import { PRICING_MODELS, PRICING_MODEL_LABELS } from '../constants/pricing-models'
import { useUpsertServiceBasePrice } from '../hooks'
import { parsePriceToCents, formatCentsToDisplay } from '../utils/pricing'

interface ServiceEditorDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  service?: Service | null  // null = create mode
  basePriceCents?: number | null
  onSubmit: (data: ServiceFormData) => Promise<{ success: boolean; serviceId?: string; error?: Error }>
  onSuccess?: () => void
}

interface FormErrors {
  name?: string
  duration?: string
  price?: string
}

export function ServiceEditorDrawer({
  open,
  onOpenChange,
  service,
  basePriceCents,
  onSubmit,
  onSuccess,
}: ServiceEditorDrawerProps) {
  const { toast } = useToast()
  const isEditMode = !!service

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState('')
  const [pricingModel, setPricingModel] = useState<PricingModel>('fixed')
  const [price, setPrice] = useState('')
  const [colorHex, setColorHex] = useState('')
  const [requiresConsent, setRequiresConsent] = useState(false)

  const isCategoryPricing = pricingModel === 'by_profession_category'
  const usesBasePrice =
    pricingModel === 'fixed' || pricingModel === 'by_profession_hourly_prorata'

  // UI state
  const [errors, setErrors] = useState<FormErrors>({})
  const [isLoading, setIsLoading] = useState(false)

  // Mutations
  const setBasePriceMutation = useUpsertServiceBasePrice()

  // Initialize form when service changes
  useEffect(() => {
    if (service) {
      setName(service.name)
      setDescription(service.description || '')
      setDuration(service.duration?.toString() || '')
      setPricingModel(service.pricingModel)
      setPrice(formatCentsToDisplay(basePriceCents ?? null))
      setColorHex(service.colorHex || '')
      setRequiresConsent(service.requiresConsent)
    } else {
      resetForm()
    }
  }, [service, basePriceCents, open])

  const resetForm = () => {
    setName('')
    setDescription('')
    setDuration('')
    setPricingModel('fixed')
    setPrice('')
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

    if (usesBasePrice) {
      const cents = parsePriceToCents(price)
      if (cents === null) {
        newErrors.price = t('pages.services.validation.priceRequired')
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

    // Step 1: Save the service
    const result = await onSubmit(formData)

    if (!result.success) {
      setIsLoading(false)
      return
    }

    const serviceId = result.serviceId ?? service?.id

    if (!serviceId) {
      setIsLoading(false)
      return
    }

    // Step 2: Save the base price (fixed/hourly)
    if (usesBasePrice || isEditMode) {
      try {
        const priceCents = usesBasePrice ? parsePriceToCents(price) : null
        await setBasePriceMutation.mutateAsync({
          serviceId,
          priceCents,
        })
      } catch {
        toast({
          title: t('pages.services.pricing.basePriceSaveError'),
          variant: 'error',
        })
        setIsLoading(false)
        return
      }
    }

    // Note: Tax logic is now handled at the profession category level
    // (profession_categories.tax_included), not per-service.

    setIsLoading(false)
    onOpenChange(false)
    resetForm()
    onSuccess?.()
  }

  const handleClose = () => {
    onOpenChange(false)
    resetForm()
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="fixed right-0 top-0 h-screen w-full max-w-lg translate-x-0 translate-y-0 rounded-none rounded-l-2xl border-l p-0 gap-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right data-[state=closed]:duration-300 data-[state=open]:duration-300"
        style={{
          left: 'auto',
          top: 0,
          transform: 'none',
          maxHeight: '100vh',
        }}
      >
        <div className="flex h-full flex-col overflow-hidden">
          {/* Header */}
          <DialogHeader className="flex-shrink-0 border-b border-border px-6 py-4">
            <DialogTitle>
              {isEditMode ? t('pages.services.edit.title') : t('pages.services.create.title')}
            </DialogTitle>
            {!isEditMode && (
              <DialogDescription>
                {t('pages.services.create.subtitle')}
              </DialogDescription>
            )}
            {isEditMode && (
              <DialogDescription className="sr-only">
                Modifier les détails du service
              </DialogDescription>
            )}
          </DialogHeader>

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

            {isCategoryPricing && (
              <div className="rounded-xl border border-border bg-background-secondary/60 px-4 py-3 text-xs text-foreground-muted">
                {t('pages.services.pricing.categoryHint')}
              </div>
            )}

            {usesBasePrice && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  {pricingModel === 'by_profession_hourly_prorata'
                    ? t('pages.services.create.fields.hourlyRate')
                    : t('pages.services.create.fields.price')}
                  <span className="text-wine-500 ml-0.5">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-foreground-muted pointer-events-none">
                    $
                  </span>
                  <Input
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    onBlur={() => setPrice(formatCentsToDisplay(parsePriceToCents(price)))}
                    placeholder={t('pages.services.create.fields.pricePlaceholder')}
                    className={cn('pl-7 text-right', errors.price && 'border-wine-300')}
                  />
                </div>
                {errors.price ? (
                  <p className="text-xs text-wine-600">{errors.price}</p>
                ) : (
                  <p className="text-xs text-foreground-muted">
                    {pricingModel === 'by_profession_hourly_prorata'
                      ? t('pages.services.pricing.hourlyRateHelper')
                      : t('pages.services.create.fields.priceHelper')}
                  </p>
                )}
              </div>
            )}

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

            {/* Note: Tax logic is now handled at the profession category level */}
            {!isCategoryPricing && (
              <div className="rounded-xl border border-border bg-background-secondary/60 px-4 py-3 text-xs text-foreground-muted">
                Les taxes sont gérées par catégorie professionnelle dans la section Tarification.
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 flex gap-3 border-t border-border px-6 py-4">
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

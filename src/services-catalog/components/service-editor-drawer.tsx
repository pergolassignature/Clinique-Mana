// src/services-catalog/components/service-editor-drawer.tsx

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import {
  Dialog,
  DialogContent,
} from '@/shared/ui/dialog'
import { Select } from '@/shared/ui/select'
import type { Service, ServiceFormData, ServiceInternalType, ServiceVariant } from '../types'
import { INTERNAL_TYPE_LABELS } from '../constants'

interface ServiceEditorDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  service?: Service | null  // null = create mode
  onSubmit: (data: ServiceFormData) => Promise<{ success: boolean; error?: Error }>
  onSuccess?: () => void
}

const INTERNAL_TYPES: ServiceInternalType[] = [
  'ouverture_dossier',
  'consultation',
  'appel_decouverte',
  'annulation_frais',
  'autre',
]

interface FormErrors {
  name?: string
  duration?: string
  price?: string
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
  const [price, setPrice] = useState('')
  const [isOnlineAvailable, setIsOnlineAvailable] = useState(false)
  const [internalType, setInternalType] = useState<ServiceInternalType>('consultation')
  const [variants, setVariants] = useState<Omit<ServiceVariant, 'id'>[]>([])

  // UI state
  const [variantsExpanded, setVariantsExpanded] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [isLoading, setIsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'details' | 'parameters' | 'status'>('details')

  // Initialize form when service changes
  useEffect(() => {
    if (service) {
      setName(service.name)
      setDescription(service.description || '')
      setDuration(service.duration.toString())
      setPrice(service.price.toString())
      setIsOnlineAvailable(service.isOnlineAvailable)
      setInternalType(service.internalType)
      setVariants(service.variants.map(v => ({
        label: v.label,
        priceOverride: v.priceOverride,
        durationOverride: v.durationOverride,
      })))
      setVariantsExpanded(service.variants.length > 0)
    } else {
      resetForm()
    }
  }, [service, open])

  const resetForm = () => {
    setName('')
    setDescription('')
    setDuration('')
    setPrice('')
    setIsOnlineAvailable(false)
    setInternalType('consultation')
    setVariants([])
    setVariantsExpanded(false)
    setErrors({})
    setActiveTab('details')
  }

  const validate = (): boolean => {
    const newErrors: FormErrors = {}

    if (!name.trim()) {
      newErrors.name = t('pages.services.validation.nameRequired')
    }

    const durationNum = parseInt(duration, 10)
    if (isNaN(durationNum)) {
      newErrors.duration = t('pages.services.validation.durationRequired')
    } else if (durationNum < 0) {
      newErrors.duration = t('pages.services.validation.durationMin')
    }

    const priceNum = parseFloat(price)
    if (isNaN(priceNum)) {
      newErrors.price = t('pages.services.validation.priceRequired')
    } else if (priceNum < 0) {
      newErrors.price = t('pages.services.validation.priceMin')
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
      duration: parseInt(duration, 10),
      price: parseFloat(price),
      isOnlineAvailable,
      internalType,
      variants: variants.filter(v => v.label.trim()),
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

  const addVariant = () => {
    setVariants([...variants, { label: '' }])
  }

  const updateVariant = (index: number, updates: Partial<Omit<ServiceVariant, 'id'>>) => {
    const newVariants = [...variants]
    newVariants[index] = { ...newVariants[index], ...updates } as Omit<ServiceVariant, 'id'>
    setVariants(newVariants)
  }

  const removeVariant = (index: number) => {
    setVariants(variants.filter((_, i) => i !== index))
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

          {/* Tabs */}
          <div className="flex border-b border-border px-6">
            {(['details', 'parameters', 'status'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
                  activeTab === tab
                    ? 'border-sage-500 text-sage-700'
                    : 'border-transparent text-foreground-muted hover:text-foreground'
                )}
              >
                {t(`pages.services.create.tabs.${tab}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <AnimatePresence mode="wait">
              {activeTab === 'details' && (
                <motion.div
                  key="details"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-4"
                >
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
                </motion.div>
              )}

              {activeTab === 'parameters' && (
                <motion.div
                  key="parameters"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-4"
                >
                  {/* Duration & Price row */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Duration */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground">
                        {t('pages.services.create.fields.duration')}
                        <span className="text-wine-500 ml-0.5">*</span>
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

                    {/* Price */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground">
                        {t('pages.services.create.fields.price')}
                        <span className="text-wine-500 ml-0.5">*</span>
                      </label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder={t('pages.services.create.fields.pricePlaceholder')}
                        className={cn(errors.price && 'border-wine-300')}
                      />
                      {errors.price ? (
                        <p className="text-xs text-wine-600">{errors.price}</p>
                      ) : (
                        <p className="text-xs text-foreground-muted">
                          {t('pages.services.create.fields.priceHelper')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Online availability */}
                  <div className="flex items-center justify-between rounded-xl border border-border p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {t('pages.services.create.fields.isOnlineAvailable')}
                      </p>
                      <p className="text-xs text-foreground-muted mt-0.5">
                        {t('pages.services.create.fields.isOnlineAvailableHelper')}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isOnlineAvailable}
                      onClick={() => setIsOnlineAvailable(!isOnlineAvailable)}
                      className={cn(
                        'relative h-6 w-11 rounded-full transition-colors',
                        isOnlineAvailable ? 'bg-sage-500' : 'bg-background-tertiary'
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                          isOnlineAvailable && 'translate-x-5'
                        )}
                      />
                    </button>
                  </div>

                  {/* Internal type */}
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground">
                      {t('pages.services.create.fields.internalType')}
                    </label>
                    <Select
                      value={internalType}
                      onChange={(e) => setInternalType(e.target.value as ServiceInternalType)}
                    >
                      {INTERNAL_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {t(INTERNAL_TYPE_LABELS[type] as Parameters<typeof t>[0])}
                        </option>
                      ))}
                    </Select>
                    <p className="text-xs text-foreground-muted">
                      {t('pages.services.create.fields.internalTypeHelper')}
                    </p>
                  </div>

                  {/* Variants section */}
                  <div className="rounded-xl border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setVariantsExpanded(!variantsExpanded)}
                      className="flex w-full items-center justify-between p-4 hover:bg-background-secondary/50 transition-colors"
                    >
                      <div className="text-left">
                        <p className="text-sm font-medium text-foreground">
                          {t('pages.services.create.variants.title')}
                        </p>
                        <p className="text-xs text-foreground-muted mt-0.5">
                          {t('pages.services.create.variants.subtitle')}
                        </p>
                      </div>
                      {variantsExpanded ? (
                        <ChevronUp className="h-5 w-5 text-foreground-muted" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-foreground-muted" />
                      )}
                    </button>

                    <AnimatePresence>
                      {variantsExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="border-t border-border"
                        >
                          <div className="p-4 space-y-3">
                            {variants.map((variant, index) => (
                              <div
                                key={index}
                                className="flex items-start gap-2 rounded-lg border border-border-light bg-background-secondary/30 p-3"
                              >
                                <div className="flex-1 space-y-2">
                                  <Input
                                    value={variant.label}
                                    onChange={(e) => updateVariant(index, { label: e.target.value })}
                                    placeholder={t('pages.services.create.variants.labelPlaceholder')}
                                    className="h-9"
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <Input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={variant.priceOverride ?? ''}
                                      onChange={(e) => updateVariant(index, {
                                        priceOverride: e.target.value ? parseFloat(e.target.value) : undefined,
                                      })}
                                      placeholder={t('pages.services.create.variants.inheritPrice')}
                                      className="h-9"
                                    />
                                    <Input
                                      type="number"
                                      min="0"
                                      value={variant.durationOverride ?? ''}
                                      onChange={(e) => updateVariant(index, {
                                        durationOverride: e.target.value ? parseInt(e.target.value, 10) : undefined,
                                      })}
                                      placeholder={t('pages.services.create.variants.inheritDuration')}
                                      className="h-9"
                                    />
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 text-foreground-muted hover:text-wine-600"
                                  onClick={() => removeVariant(index)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}

                            <Button
                              variant="outline"
                              size="sm"
                              onClick={addVariant}
                              className="w-full"
                            >
                              <Plus className="h-4 w-4 mr-1.5" />
                              {t('pages.services.create.variants.add')}
                            </Button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}

              {activeTab === 'status' && (
                <motion.div
                  key="status"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-4"
                >
                  <div className="rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {t('pages.services.table.status')}
                        </p>
                        <p className="text-xs text-foreground-muted mt-0.5">
                          {isEditMode && service
                            ? service.isActive
                              ? 'Ce service est actuellement actif et visible.'
                              : 'Ce service est archivé et non visible.'
                            : 'Le service sera créé comme actif.'}
                        </p>
                      </div>
                      <Badge variant={(!isEditMode || service?.isActive) ? 'success' : 'secondary'}>
                        {(!isEditMode || service?.isActive)
                          ? t('pages.services.values.active')
                          : t('pages.services.values.archived')}
                      </Badge>
                    </div>
                  </div>

                  {isEditMode && service && (
                    <p className="text-xs text-foreground-muted text-center">
                      Pour archiver ou restaurer ce service, utilisez le menu d'actions dans la liste.
                    </p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
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

// src/services-catalog/components/category-pricing-section.tsx

import { useState, useMemo, useCallback, useEffect } from 'react'
import { Check, DollarSign, Loader2 } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Select } from '@/shared/ui/select'
import { Badge } from '@/shared/ui/badge'
import { Checkbox } from '@/shared/ui/checkbox'
import { Switch } from '@/shared/ui/switch'
import { Skeleton } from '@/shared/ui/skeleton'
import { useToast } from '@/shared/hooks/use-toast'
import {
  useServices,
  useProfessionCategories,
  useProfessionTitles,
  useCategoryPrices,
  useUpsertCategoryPrices,
  useUpdateCategoryTaxIncluded,
  useProfessionCategoryRates,
} from '../hooks'
import type { Service, ProfessionCategory, ProfessionTitle } from '../types'
import { parsePriceToCents, formatCentsToDisplay } from '../utils/pricing'
import { formatPriceWithTax, calculateTotal, formatCents } from '@/utils/tax'

interface PriceInputCellProps {
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  onBlur: () => void
}

function PriceInputCell({ value, disabled, onChange, onBlur }: PriceInputCellProps) {
  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-foreground-muted pointer-events-none">
        $
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="-"
        disabled={disabled}
        className={cn(
          'w-24 rounded-lg border border-border bg-background pl-6 pr-2 py-1.5 text-sm text-right',
          'placeholder:text-foreground-muted/40',
          'focus:border-sage-300 focus:outline-none focus:ring-2 focus:ring-sage-500/20',
          'transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed'
        )}
      />
    </div>
  )
}

interface CategoryServiceRowProps {
  service: Service
  isEnabled: boolean
  value: string
  taxIncluded: boolean
  onToggle: (serviceId: string, enabled: boolean) => void
  onChange: (serviceId: string, value: string) => void
  onBlur: (serviceId: string) => void
}

function CategoryServiceRow({
  service,
  isEnabled,
  value,
  taxIncluded,
  onToggle,
  onChange,
  onBlur,
}: CategoryServiceRowProps) {
  // Calculate display price with tax breakdown
  const priceCents = parsePriceToCents(value)
  const displayPrice = useMemo(() => {
    if (!isEnabled || priceCents === null) return null
    return formatPriceWithTax(priceCents, taxIncluded)
  }, [isEnabled, priceCents, taxIncluded])

  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {service.colorHex && (
          <div
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: service.colorHex }}
          />
        )}
        <div className="flex items-center gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">{service.name}</p>
            {service.duration && (
              <p className="text-xs text-foreground-muted">
                {service.duration} min
              </p>
            )}
          </div>
          <Badge
            variant={taxIncluded ? 'warning' : 'secondary'}
            className="text-[10px] px-1.5 py-0 h-4"
          >
            {taxIncluded
              ? t('pages.services.pricing.taxable')
              : t('pages.services.pricing.taxExempt')}
          </Badge>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <label className="flex items-center gap-2 text-xs text-foreground-muted">
          <Checkbox
            checked={isEnabled}
            onCheckedChange={(checked) => onToggle(service.id, checked === true)}
          />
          {t('pages.services.pricing.offered')}
        </label>
        <div className="flex items-center gap-2">
          <PriceInputCell
            value={value}
            disabled={!isEnabled}
            onChange={(nextValue) => onChange(service.id, nextValue)}
            onBlur={() => onBlur(service.id)}
          />
          {displayPrice && taxIncluded && (
            <span className="text-xs text-foreground-muted whitespace-nowrap">
              = {formatCents(calculateTotal(priceCents!))} $
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

interface HourlyServiceRowProps {
  service: Service
  taxIncluded: boolean
  hourlyRateCents: number | null
}

function HourlyServiceRow({ service, taxIncluded, hourlyRateCents }: HourlyServiceRowProps) {
  const formattedRate = hourlyRateCents !== null
    ? `${formatCents(hourlyRateCents)} $/h`
    : t('pages.services.pricing.rateNotSet')

  const formattedWithTax = hourlyRateCents !== null && taxIncluded
    ? `= ${formatCents(calculateTotal(hourlyRateCents))} $/h`
    : null

  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {service.colorHex && (
          <div
            className="h-2.5 w-2.5 rounded-full shrink-0"
            style={{ backgroundColor: service.colorHex }}
          />
        )}
        <div className="flex items-center gap-2">
          <div>
            <p className="text-sm font-medium text-foreground">{service.name}</p>
            <p className="text-xs text-foreground-muted">
              {t('pages.services.pricing.hourlyProrata')}
            </p>
          </div>
          <Badge
            variant={taxIncluded ? 'warning' : 'secondary'}
            className="text-[10px] px-1.5 py-0 h-4"
          >
            {taxIncluded
              ? t('pages.services.pricing.taxable')
              : t('pages.services.pricing.taxExempt')}
          </Badge>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {formattedRate}
        </span>
        {formattedWithTax && (
          <span className="text-xs text-foreground-muted whitespace-nowrap">
            {formattedWithTax}
          </span>
        )}
      </div>
    </div>
  )
}

function buildCategoryTitle(categories: ProfessionCategory[], titles: ProfessionTitle[], key: string) {
  const category = categories.find((item) => item.key === key)
  if (!category) return null

  const titleLabels = new Set(
    titles
      .filter((title) => title.professionCategoryKey === key)
      .map((title) => title.labelFr)
  )

  return {
    category,
    titleLabel: titleLabels.size > 0 ? Array.from(titleLabels).join(' / ') : null,
  }
}

export function CategoryPricingSection() {
  const { toast } = useToast()
  const { data: services = [], isLoading: isLoadingServices } = useServices()
  const { data: categories = [], isLoading: isLoadingCategories } = useProfessionCategories()
  const { data: titles = [], isLoading: isLoadingTitles } = useProfessionTitles()
  const { data: prices = [], isLoading: isLoadingPrices } = useCategoryPrices()
  const { data: hourlyRates = [] } = useProfessionCategoryRates()

  const upsertMutation = useUpsertCategoryPrices()
  const taxMutation = useUpdateCategoryTaxIncluded()
  const isLoading = isLoadingServices || isLoadingCategories || isLoadingTitles || isLoadingPrices

  const [selectedCategoryKey, setSelectedCategoryKey] = useState('')
  const [formValues, setFormValues] = useState<Map<string, string>>(new Map())
  const [enabledServices, setEnabledServices] = useState<Set<string>>(new Set())
  const [localTaxIncluded, setLocalTaxIncluded] = useState<boolean | null>(null)

  const categoryBasedServices = useMemo(() => {
    return services
      .filter((service) => service.pricingModel === 'by_profession_category' && service.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder)
  }, [services])

  // Hourly prorata services also follow category tax rules but don't have per-service prices
  const hourlyProrataServices = useMemo(() => {
    return services
      .filter((service) => service.pricingModel === 'by_profession_hourly_prorata' && service.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder)
  }, [services])

  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => a.labelFr.localeCompare(b.labelFr, 'fr-CA'))
  }, [categories])

  useEffect(() => {
    const firstCategory = sortedCategories[0]
    if (!selectedCategoryKey && firstCategory) {
      setSelectedCategoryKey(firstCategory.key)
    }
  }, [selectedCategoryKey, sortedCategories])

  const categoryInfo = useMemo(() => {
    if (!selectedCategoryKey) return null
    return buildCategoryTitle(sortedCategories, titles, selectedCategoryKey)
  }, [selectedCategoryKey, sortedCategories, titles])

  const priceLookup = useMemo(() => {
    const lookup = new Map<string, { priceCents: number; isActive: boolean }>()
    for (const price of prices) {
      if (price.professionCategoryKey !== selectedCategoryKey) continue
      lookup.set(price.serviceId, { priceCents: price.priceCents, isActive: price.isActive })
    }
    return lookup
  }, [prices, selectedCategoryKey])

  const hourlyRateLookup = useMemo(() => {
    const lookup = new Map<string, number>()
    for (const rate of hourlyRates) {
      lookup.set(rate.professionCategoryKey, rate.hourlyRateCents)
    }
    return lookup
  }, [hourlyRates])

  useEffect(() => {
    if (!selectedCategoryKey) return
    const initialValues = new Map<string, string>()
    const initialEnabled = new Set<string>()

    for (const service of categoryBasedServices) {
      const saved = priceLookup.get(service.id)
      initialValues.set(service.id, formatCentsToDisplay(saved?.priceCents ?? null))
      if (saved?.isActive) {
        initialEnabled.add(service.id)
      }
    }

    setFormValues(initialValues)
    setEnabledServices(initialEnabled)
    setLocalTaxIncluded(null) // Reset tax toggle when category changes
  }, [selectedCategoryKey, categoryBasedServices, priceLookup])

  const handleToggle = useCallback((serviceId: string, enabled: boolean) => {
    setEnabledServices((prev) => {
      const next = new Set(prev)
      if (enabled) {
        next.add(serviceId)
      } else {
        next.delete(serviceId)
      }
      return next
    })
  }, [])

  const handleChange = useCallback((serviceId: string, value: string) => {
    setFormValues((prev) => {
      const next = new Map(prev)
      next.set(serviceId, value)
      return next
    })
  }, [])

  const handleBlur = useCallback((serviceId: string) => {
    setFormValues((prev) => {
      const next = new Map(prev)
      const value = next.get(serviceId) || ''
      const cents = parsePriceToCents(value)
      next.set(serviceId, formatCentsToDisplay(cents))
      return next
    })
  }, [])

  const hasChanges = useMemo(() => {
    // Check if tax status changed
    const originalTaxIncluded = categoryInfo?.category?.taxIncluded ?? false
    const currentTaxIncluded = localTaxIncluded ?? originalTaxIncluded
    if (originalTaxIncluded !== currentTaxIncluded) return true

    // Check price changes
    for (const service of categoryBasedServices) {
      const saved = priceLookup.get(service.id)
      const savedActive = saved?.isActive ?? false
      const savedCents = savedActive ? saved?.priceCents ?? null : null

      const currentValue = formValues.get(service.id) || ''
      const currentCents = parsePriceToCents(currentValue)
      const currentActive = enabledServices.has(service.id)
      const targetCents = currentActive ? currentCents : null

      if (savedActive !== currentActive) return true
      if (savedCents !== targetCents) return true
    }
    return false
  }, [categoryBasedServices, priceLookup, formValues, enabledServices, categoryInfo, localTaxIncluded])

  const handleSave = async () => {
    if (!selectedCategoryKey) return

    const priceInputs = []
    let hasInvalid = false

    for (const service of categoryBasedServices) {
      const isEnabled = enabledServices.has(service.id)
      const value = formValues.get(service.id) || ''
      const cents = parsePriceToCents(value)

      if (isEnabled && cents === null) {
        hasInvalid = true
      }

      priceInputs.push({
        serviceId: service.id,
        priceCents: isEnabled ? cents : null,
      })
    }

    if (hasInvalid) {
      toast({
        title: t('pages.services.pricing.missingPrices'),
        variant: 'error',
      })
      return
    }

    try {
      // Save tax status if changed
      const originalTaxIncluded = categoryInfo?.category?.taxIncluded ?? false
      const currentTaxIncluded = localTaxIncluded ?? originalTaxIncluded

      if (originalTaxIncluded !== currentTaxIncluded) {
        await taxMutation.mutateAsync({
          categoryKey: selectedCategoryKey,
          taxIncluded: currentTaxIncluded,
        })
      }

      // Save prices
      await upsertMutation.mutateAsync({
        categoryKey: selectedCategoryKey,
        prices: priceInputs,
      })

      // Reset local state
      setLocalTaxIncluded(null)

      toast({
        title: t('pages.services.pricing.saveSuccess'),
      })
    } catch {
      toast({
        title: t('pages.services.pricing.saveError'),
        variant: 'error',
      })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  if (categoryBasedServices.length === 0 && hourlyProrataServices.length === 0) {
    return null
  }

  const enabledCount = enabledServices.size

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-sage-600" />
            {t('pages.services.pricing.title')}
          </h2>
          <p className="text-sm text-foreground-muted mt-1">
            {t('pages.services.pricing.subtitle')}
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!selectedCategoryKey || !hasChanges || upsertMutation.isPending || taxMutation.isPending}
        >
          {(upsertMutation.isPending || taxMutation.isPending) ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          {t('pages.services.pricing.save')}
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-background p-4 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              {t('pages.services.pricing.categoryLabel')}
            </label>
            <Select
              value={selectedCategoryKey}
              onChange={(e) => setSelectedCategoryKey(e.target.value)}
              className="w-full sm:w-[280px]"
            >
              {sortedCategories.map((category) => (
                <option key={category.key} value={category.key}>
                  {category.labelFr}
                </option>
              ))}
            </Select>
          </div>
          {categoryInfo?.category && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={localTaxIncluded ?? categoryInfo.category.taxIncluded}
                  onCheckedChange={setLocalTaxIncluded}
                />
                <span className="text-sm text-foreground">
                  {t('pages.services.pricing.taxToggleLabel')}
                </span>
              </label>
              <Badge variant={(localTaxIncluded ?? categoryInfo.category.taxIncluded) ? 'warning' : 'secondary'}>
                {(localTaxIncluded ?? categoryInfo.category.taxIncluded)
                  ? t('pages.services.pricing.taxable')
                  : t('pages.services.pricing.taxExempt')}
              </Badge>
              {categoryInfo.titleLabel && (
                <Badge variant="outline">{categoryInfo.titleLabel}</Badge>
              )}
            </div>
          )}
        </div>

        <div className="divide-y divide-border">
          {categoryBasedServices.map((service) => (
            <CategoryServiceRow
              key={service.id}
              service={service}
              isEnabled={enabledServices.has(service.id)}
              value={formValues.get(service.id) || ''}
              taxIncluded={localTaxIncluded ?? categoryInfo?.category?.taxIncluded ?? false}
              onToggle={handleToggle}
              onChange={handleChange}
              onBlur={handleBlur}
            />
          ))}
        </div>

        {hourlyProrataServices.length > 0 && (
          <>
            <div className="border-t border-border pt-4 mt-2">
              <p className="text-xs font-medium text-foreground-muted mb-2">
                {t('pages.services.pricing.hourlyProrata')}
              </p>
            </div>
            <div className="divide-y divide-border">
              {hourlyProrataServices.map((service) => (
                <HourlyServiceRow
                  key={service.id}
                  service={service}
                  taxIncluded={localTaxIncluded ?? categoryInfo?.category?.taxIncluded ?? false}
                  hourlyRateCents={hourlyRateLookup.get(selectedCategoryKey) ?? null}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-foreground-muted text-center">
        {enabledCount} service{enabledCount > 1 ? 's' : ''} offert
        {enabledCount > 1 ? 's' : ''} pour cette catégorie
      </p>
    </section>
  )
}

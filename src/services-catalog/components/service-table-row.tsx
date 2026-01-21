// src/services-catalog/components/service-table-row.tsx

import { MoreHorizontal, Pencil, Archive, RotateCcw, Copy, FileCheck } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import type { Service, ServicePrice, ServiceTaxProfile } from '../types'
import { PRICING_MODEL_LABELS } from '../constants/pricing-models'

interface ServiceTableRowProps {
  service: Service
  prices?: ServicePrice[]  // Optional: prices for this service
  taxProfile?: ServiceTaxProfile  // Tax profile for this service
  onEdit: (service: Service) => void
  onArchive: (service: Service) => void
  onRestore: (service: Service) => void
  onDuplicate?: (service: Service) => void
}

export function ServiceTableRow({
  service,
  prices,
  taxProfile,
  onEdit,
  onArchive,
  onRestore,
  onDuplicate,
}: ServiceTableRowProps) {
  const formatDuration = (minutes: number | undefined) => {
    if (!minutes) return '—'
    return `${minutes} ${t('pages.services.values.minutes')}`
  }

  const formatPrice = (priceCents: number) => {
    if (priceCents === 0) return '0 $'
    const dollars = priceCents / 100
    return `${dollars.toFixed(2).replace('.00', '')} $`
  }

  // Get display price based on pricing model
  const getDisplayPrice = () => {
    const activePrices = prices?.filter((price) => price.isActive) || []

    if (service.pricingModel === 'fixed' && activePrices.length > 0) {
      // Find the global price (no profession category)
      const globalPrice = activePrices.find((p) => p.professionCategoryKey === null)
      if (globalPrice) {
        return formatPrice(globalPrice.priceCents)
      }
    }

    if (service.pricingModel === 'by_profession_category') {
      return 'Variable'
    }

    if (service.pricingModel === 'rule_cancellation_prorata') {
      return 'Prorata'
    }

    if (service.pricingModel === 'by_profession_hourly_prorata') {
      const hourlyPrice = activePrices.find((p) => p.professionCategoryKey === null)
      if (hourlyPrice) {
        return `${formatPrice(hourlyPrice.priceCents)} / h`
      }
      return 'À la minute'
    }

    return '—'
  }

  return (
    <tr
      className={cn(
        'border-b border-border last:border-b-0 transition-colors',
        service.isActive
          ? 'hover:bg-sage-50/30'
          : 'bg-background-secondary/50 opacity-75'
      )}
    >
      {/* Name + color indicator */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {service.colorHex && (
            <div
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: service.colorHex }}
            />
          )}
          <span className="text-[13px] font-medium text-foreground">{service.name}</span>
        </div>
      </td>

      {/* Duration */}
      <td className="px-4 py-3 text-xs text-foreground-secondary">
        {formatDuration(service.duration)}
      </td>

      {/* Price */}
      <td className="px-4 py-3 text-xs text-foreground-secondary">
        {getDisplayPrice()}
      </td>

      {/* Pricing Model */}
      <td className="px-4 py-3">
        <Badge variant="secondary" className="text-[11px] font-normal">
          {t(PRICING_MODEL_LABELS[service.pricingModel] as Parameters<typeof t>[0])}
        </Badge>
      </td>

      {/* Consent */}
      <td className="px-4 py-3">
        {service.requiresConsent && (
          <FileCheck className="h-4 w-4 text-sage-600" />
        )}
      </td>

      {/* Tax Status */}
      <td className="px-4 py-3">
        {service.pricingModel === 'by_profession_category' ? (
          <Badge variant="secondary" className="text-[11px]">
            {t('pages.services.taxes.byCategoryBadge')}
          </Badge>
        ) : (
          <Badge
            variant={taxProfile === 'tps_tvq' ? 'outline' : 'secondary'}
            className="text-[11px]"
          >
            {taxProfile === 'tps_tvq'
              ? t('pages.services.taxes.taxableBadge')
              : t('pages.services.taxes.exemptBadge')}
          </Badge>
        )}
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <Badge
          variant={service.isActive ? 'success' : 'secondary'}
          className="text-[11px]"
        >
          {service.isActive
            ? t('pages.services.values.active')
            : t('pages.services.values.archived')}
        </Badge>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onEdit(service)}>
              <Pencil className="h-4 w-4 mr-2" />
              {t('pages.services.actions.edit')}
            </DropdownMenuItem>

            {onDuplicate && (
              <DropdownMenuItem onClick={() => onDuplicate(service)}>
                <Copy className="h-4 w-4 mr-2" />
                {t('pages.services.actions.duplicate')}
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            {service.isActive ? (
              <DropdownMenuItem
                onClick={() => onArchive(service)}
                className="text-wine-600 focus:text-wine-600"
              >
                <Archive className="h-4 w-4 mr-2" />
                {t('pages.services.actions.archive')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => onRestore(service)}
                className="text-sage-600 focus:text-sage-600"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {t('pages.services.actions.restore')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  )
}

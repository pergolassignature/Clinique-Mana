// src/services-catalog/components/service-table-row.tsx

import { MoreHorizontal, Pencil, Archive, RotateCcw, Copy } from 'lucide-react'
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
import type { Service } from '../types'

interface ServiceTableRowProps {
  service: Service
  onEdit: (service: Service) => void
  onArchive: (service: Service) => void
  onRestore: (service: Service) => void
  onDuplicate?: (service: Service) => void
}

export function ServiceTableRow({
  service,
  onEdit,
  onArchive,
  onRestore,
  onDuplicate,
}: ServiceTableRowProps) {
  const formatPrice = (price: number) => {
    if (price === 0) return '0 $'
    return `${price.toFixed(2).replace('.00', '')} $`
  }

  const formatDuration = (minutes: number) => {
    if (minutes === 0) return '—'
    return `${minutes} ${t('pages.services.values.minutes')}`
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
      {/* Name + variants count */}
      <td className="px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{service.name}</span>
          {service.variants.length > 0 && (
            <span className="text-xs text-foreground-muted">
              {service.variants.length} {t('pages.services.values.variantsCount')}
            </span>
          )}
        </div>
      </td>

      {/* Duration */}
      <td className="px-4 py-3 text-sm text-foreground-secondary">
        {formatDuration(service.duration)}
      </td>

      {/* Price */}
      <td className="px-4 py-3 text-sm text-foreground-secondary">
        {formatPrice(service.price)}
      </td>

      {/* Mode */}
      <td className="px-4 py-3 text-sm text-foreground-muted">
        {t('pages.services.values.modeAppointment')}
      </td>

      {/* Online availability */}
      <td className="px-4 py-3">
        <Badge
          variant={service.isOnlineAvailable ? 'default' : 'secondary'}
          className="text-xs"
        >
          {service.isOnlineAvailable
            ? t('pages.services.values.onlineYes')
            : t('pages.services.values.onlineNo')}
        </Badge>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <Badge
          variant={service.isActive ? 'success' : 'secondary'}
          className="text-xs"
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

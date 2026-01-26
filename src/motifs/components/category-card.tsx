// src/motifs/components/category-card.tsx
// Card component for displaying a motif category in the admin list

import { MoreHorizontal, Archive, RotateCcw, Pencil } from 'lucide-react'
import * as Icons from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import type { MotifCategory } from '../types'

interface CategoryCardProps {
  category: MotifCategory
  motifCount: number
  onEdit: () => void
  onArchive: () => void
  onRestore: () => void
}

export function CategoryCard({
  category,
  motifCount,
  onEdit,
  onArchive,
  onRestore,
}: CategoryCardProps) {
  // Dynamically get the icon from Lucide
  const IconComponent = category.iconName
    ? (Icons[category.iconName as keyof typeof Icons] as React.ComponentType<{ className?: string }>)
    : null

  return (
    <div
      className={cn(
        'group relative rounded-lg border p-4 transition-colors',
        category.isActive
          ? 'border-border bg-background hover:border-sage-200 hover:shadow-sm'
          : 'border-border-light bg-background-secondary/50 opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Icon and content */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {/* Icon */}
          {IconComponent && (
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                category.isActive
                  ? 'bg-sage-100 text-sage-600'
                  : 'bg-background-tertiary text-foreground-muted'
              )}
            >
              <IconComponent className="h-5 w-5" />
            </div>
          )}

          {/* Text content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4
                className={cn(
                  'text-sm font-medium truncate',
                  !category.isActive && 'text-foreground-muted'
                )}
              >
                {category.label}
              </h4>
              <Badge
                variant="secondary"
                className={cn(
                  'shrink-0 text-[10px]',
                  !category.isActive && 'opacity-60'
                )}
              >
                {motifCount} motif{motifCount !== 1 ? 's' : ''}
              </Badge>
            </div>
            {category.description && (
              <p
                className={cn(
                  'mt-1 text-xs line-clamp-2',
                  category.isActive
                    ? 'text-foreground-secondary'
                    : 'text-foreground-muted'
                )}
              >
                {category.description}
              </p>
            )}
            <p className="mt-1 text-[10px] text-foreground-muted font-mono">
              {category.key}
            </p>
          </div>
        </div>

        {/* Actions dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-4 w-4 mr-2" />
              Modifier
            </DropdownMenuItem>
            {category.isActive ? (
              <DropdownMenuItem onClick={onArchive}>
                <Archive className="h-4 w-4 mr-2" />
                Archiver
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onRestore}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Restaurer
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

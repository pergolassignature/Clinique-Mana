import { useState } from 'react'
import { ArrowUpDown, Settings2, Check } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { DemandesTableRow } from './demandes-table-row'
import type { DemandeListItem, DemandesListSort } from '../types'

interface Column {
  key: string
  labelKey: string
  sortable: boolean
  defaultVisible: boolean
  width?: string
}

const COLUMNS: Column[] = [
  { key: 'id', labelKey: 'demandes.list.columns.id', sortable: true, defaultVisible: true, width: 'w-24' },
  { key: 'status', labelKey: 'demandes.list.columns.status', sortable: true, defaultVisible: true, width: 'w-28' },
  { key: 'type', labelKey: 'demandes.list.columns.type', sortable: false, defaultVisible: true, width: 'w-28' },
  { key: 'clients', labelKey: 'demandes.list.columns.clients', sortable: false, defaultVisible: true, width: 'w-44' },
  { key: 'motifs', labelKey: 'demandes.list.columns.motifs', sortable: false, defaultVisible: true, width: 'w-40' },
  { key: 'createdAt', labelKey: 'demandes.list.columns.createdAt', sortable: true, defaultVisible: true, width: 'w-28' },
  { key: 'urgency', labelKey: 'demandes.list.columns.urgency', sortable: true, defaultVisible: true, width: 'w-24' },
]

interface DemandesTableProps {
  demandes: DemandeListItem[]
  sort?: DemandesListSort
  onSortChange?: (sort: DemandesListSort) => void
  onRowClick?: (demandeId: string) => void
  isLoading?: boolean
}

export function DemandesTable({
  demandes,
  sort,
  onSortChange,
  onRowClick,
  isLoading,
}: DemandesTableProps) {
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key))
  )

  const handleSort = (field: string) => {
    if (!onSortChange) return

    const sortField = field as DemandesListSort['field']
    if (sort?.field === sortField) {
      onSortChange({
        field: sortField,
        direction: sort.direction === 'asc' ? 'desc' : 'asc',
      })
    } else {
      onSortChange({ field: sortField, direction: 'asc' })
    }
  }

  const toggleColumn = (key: string) => {
    const newVisible = new Set(visibleColumns)
    if (newVisible.has(key)) {
      newVisible.delete(key)
    } else {
      newVisible.add(key)
    }
    setVisibleColumns(newVisible)
  }

  const resetColumns = () => {
    setVisibleColumns(new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key)))
  }

  const activeColumns = COLUMNS.filter(c => visibleColumns.has(c.key))

  return (
    <div className="rounded-lg border border-border bg-white overflow-hidden">
      {/* Table header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background-secondary">
        <span className="text-sm text-foreground-secondary">
          {demandes.length} {demandes.length === 1 ? 'demande' : 'demandes'}
        </span>

        {/* Column picker */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8">
              <Settings2 className="h-4 w-4 mr-2" />
              {t('demandes.list.columnPicker.title')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{t('demandes.list.columnPicker.title')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {COLUMNS.map(column => (
              <DropdownMenuItem
                key={column.key}
                onClick={() => toggleColumn(column.key)}
                className="flex items-center justify-between"
              >
                <span>{t(column.labelKey as Parameters<typeof t>[0])}</span>
                {visibleColumns.has(column.key) && (
                  <Check className="h-4 w-4 text-sage-500" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={resetColumns}>
              {t('demandes.list.columnPicker.reset')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-background-tertiary">
              {activeColumns.map(column => (
                <th
                  key={column.key}
                  className={cn(
                    'px-4 py-3 text-left text-xs font-medium text-foreground-secondary uppercase tracking-wider',
                    column.width
                  )}
                >
                  {column.sortable ? (
                    <button
                      onClick={() => handleSort(column.key)}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      {t(column.labelKey as Parameters<typeof t>[0])}
                      <ArrowUpDown
                        className={cn(
                          'h-3 w-3',
                          sort?.field === column.key ? 'text-sage-500' : 'text-foreground-muted'
                        )}
                      />
                    </button>
                  ) : (
                    t(column.labelKey as Parameters<typeof t>[0])
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              // Loading skeleton
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {activeColumns.map(column => (
                    <td key={column.key} className="px-4 py-4">
                      <div className="h-4 bg-background-tertiary rounded w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : demandes.length === 0 ? (
              <tr>
                <td
                  colSpan={activeColumns.length}
                  className="px-4 py-12 text-center text-foreground-secondary"
                >
                  {t('demandes.list.empty.filteredTitle')}
                </td>
              </tr>
            ) : (
              demandes.map(demande => (
                <DemandesTableRow
                  key={demande.id}
                  demande={demande}
                  visibleColumns={visibleColumns}
                  onClick={() => onRowClick?.(demande.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

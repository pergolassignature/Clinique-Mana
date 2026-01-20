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
import { ClientTableRow } from './client-table-row'
import type { ClientListItem, ClientsListSort } from '../types'

interface Column {
  key: string
  labelKey: 'clients.list.columns.id' | 'clients.list.columns.name' | 'clients.list.columns.dob' | 'clients.list.columns.email' | 'clients.list.columns.phone' | 'clients.list.columns.lastAppointment' | 'clients.list.columns.status' | 'clients.list.columns.tags' | 'clients.list.columns.primaryProfessional'
  sortable: boolean
  defaultVisible: boolean
  width?: string
}

const COLUMNS: Column[] = [
  { key: 'clientId', labelKey: 'clients.list.columns.id', sortable: true, defaultVisible: true, width: 'w-24' },
  { key: 'name', labelKey: 'clients.list.columns.name', sortable: true, defaultVisible: true, width: 'w-44' },
  { key: 'birthday', labelKey: 'clients.list.columns.dob', sortable: true, defaultVisible: true, width: 'w-28' },
  { key: 'email', labelKey: 'clients.list.columns.email', sortable: false, defaultVisible: true, width: 'w-48' },
  { key: 'cellPhone', labelKey: 'clients.list.columns.phone', sortable: false, defaultVisible: true, width: 'w-32' },
  { key: 'lastAppointment', labelKey: 'clients.list.columns.lastAppointment', sortable: true, defaultVisible: true, width: 'w-36' },
  { key: 'status', labelKey: 'clients.list.columns.status', sortable: false, defaultVisible: true, width: 'w-24' },
  { key: 'tags', labelKey: 'clients.list.columns.tags', sortable: false, defaultVisible: false, width: 'w-40' },
  { key: 'primaryProfessional', labelKey: 'clients.list.columns.primaryProfessional', sortable: false, defaultVisible: false, width: 'w-40' },
]

interface ClientTableProps {
  clients: ClientListItem[]
  sort?: ClientsListSort
  onSortChange?: (sort: ClientsListSort) => void
  onRowClick?: (clientId: string) => void
  isLoading?: boolean
}

export function ClientTable({
  clients,
  sort,
  onSortChange,
  onRowClick,
  isLoading,
}: ClientTableProps) {
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(COLUMNS.filter(c => c.defaultVisible).map(c => c.key))
  )

  const handleSort = (field: string) => {
    if (!onSortChange) return

    const sortField = field as ClientsListSort['field']
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
          {clients.length} {clients.length === 1 ? 'client' : 'clients'}
        </span>

        {/* Column picker */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8">
              <Settings2 className="h-4 w-4 mr-2" />
              {t('clients.list.columnPicker.title')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{t('clients.list.columnPicker.title')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {COLUMNS.map(column => (
              <DropdownMenuItem
                key={column.key}
                onClick={() => toggleColumn(column.key)}
                className="flex items-center justify-between"
              >
                <span>{t(column.labelKey)}</span>
                {visibleColumns.has(column.key) && (
                  <Check className="h-4 w-4 text-sage-500" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={resetColumns}>
              {t('clients.list.columnPicker.reset')}
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
                      {t(column.labelKey)}
                      <ArrowUpDown className={cn(
                        'h-3 w-3',
                        sort?.field === column.key ? 'text-sage-500' : 'text-foreground-muted'
                      )} />
                    </button>
                  ) : (
                    t(column.labelKey)
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
            ) : clients.length === 0 ? (
              <tr>
                <td
                  colSpan={activeColumns.length}
                  className="px-4 py-12 text-center text-foreground-secondary"
                >
                  {t('clients.list.empty.filteredTitle')}
                </td>
              </tr>
            ) : (
              clients.map(client => (
                <ClientTableRow
                  key={client.clientId}
                  client={client}
                  visibleColumns={visibleColumns}
                  onClick={() => onRowClick?.(client.clientId)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

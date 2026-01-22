// src/facturation/components/ivac-report-page.tsx
// IVAC Report page - displays all IVAC allocations for billing/reporting

import { useState, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import {
  FileText,
  Download,
  Filter,
  User,
  Calendar,
  Building2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent } from '@/shared/ui/card'
import { Select } from '@/shared/ui/select'
import { cn } from '@/shared/lib/utils'
import { formatClinicDateShort, formatClinicTime } from '@/shared/lib/timezone'
import { formatCentsCurrency } from '../utils/pricing'
import { useIvacReport } from '../hooks'
import {
  PAYER_ALLOCATION_STATUS_LABELS,
  PAYER_ALLOCATION_STATUS_COLORS,
} from '../constants'
import type { PayerAllocationStatus, IvacReportFilters } from '../types'

export function IvacReportPage() {
  const [filters, setFilters] = useState<IvacReportFilters>({})
  const [sortField, setSortField] = useState<'date' | 'client' | 'professional'>('date')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')

  const { data: entries = [], isLoading, error } = useIvacReport(filters)

  // Sort entries
  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      let comparison = 0
      switch (sortField) {
        case 'date':
          comparison = new Date(a.allocationDate).getTime() - new Date(b.allocationDate).getTime()
          break
        case 'client':
          comparison = `${a.clientLastName} ${a.clientFirstName}`.localeCompare(
            `${b.clientLastName} ${b.clientFirstName}`
          )
          break
        case 'professional':
          comparison = a.professionalDisplayName.localeCompare(b.professionalDisplayName)
          break
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [entries, sortField, sortDirection])

  // Calculate totals
  const totals = useMemo(() => {
    return {
      count: entries.length,
      totalAmountCents: entries.reduce((sum, e) => sum + e.amountCents, 0),
      pendingCount: entries.filter(e => e.status === 'pending').length,
      reportedCount: entries.filter(e => e.status === 'reported').length,
      paidCount: entries.filter(e => e.status === 'paid').length,
    }
  }, [entries])

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const SortIcon = ({ field }: { field: typeof sortField }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc' ? (
      <ChevronUp className="h-4 w-4" />
    ) : (
      <ChevronDown className="h-4 w-4" />
    )
  }

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    setFilters(f => ({
      ...f,
      status: value === 'all' ? undefined : value as PayerAllocationStatus,
    }))
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-destructive">Erreur lors du chargement du rapport IVAC</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Rapport IVAC</h1>
          <p className="text-sm text-foreground-muted">
            Suivi des allocations IVAC pour la facturation
          </p>
        </div>
        <Button variant="outline" disabled>
          <Download className="h-4 w-4 mr-2" />
          Exporter CSV
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-foreground-muted">Total allocations</div>
            <div className="text-2xl font-semibold">{totals.count}</div>
            <div className="text-sm font-medium text-sage-600">
              {formatCentsCurrency(totals.totalAmountCents)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-foreground-muted">En attente</div>
            <div className="text-2xl font-semibold text-amber-600">{totals.pendingCount}</div>
            <div className="text-xs text-foreground-muted">Non déclarés</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-foreground-muted">Déclarés</div>
            <div className="text-2xl font-semibold text-sky-600">{totals.reportedCount}</div>
            <div className="text-xs text-foreground-muted">En attente paiement</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-foreground-muted">Payés</div>
            <div className="text-2xl font-semibold text-emerald-600">{totals.paidCount}</div>
            <div className="text-xs text-foreground-muted">Complétés</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-foreground-muted" />
              <span className="text-sm font-medium">Filtres</span>
            </div>
            <Select
              value={filters.status || 'all'}
              onChange={handleStatusChange}
              className="w-[180px]"
            >
              <option value="all">Tous les statuts</option>
              <option value="pending">En attente</option>
              <option value="reported">Déclarés</option>
              <option value="paid">Payés</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-pulse space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-12 bg-muted rounded" />
                ))}
              </div>
            </div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center">
              <Building2 className="h-12 w-12 text-foreground-muted mx-auto mb-4" />
              <p className="text-foreground-muted">Aucune allocation IVAC trouvée</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs border-b">
                  <tr>
                    <th
                      className="text-left p-3 cursor-pointer hover:bg-muted/70"
                      onClick={() => handleSort('date')}
                    >
                      <div className="flex items-center gap-1">
                        Date
                        <SortIcon field="date" />
                      </div>
                    </th>
                    <th
                      className="text-left p-3 cursor-pointer hover:bg-muted/70"
                      onClick={() => handleSort('client')}
                    >
                      <div className="flex items-center gap-1">
                        Client
                        <SortIcon field="client" />
                      </div>
                    </th>
                    <th className="text-left p-3">Dossier IVAC</th>
                    <th
                      className="text-left p-3 cursor-pointer hover:bg-muted/70"
                      onClick={() => handleSort('professional')}
                    >
                      <div className="flex items-center gap-1">
                        Professionnel
                        <SortIcon field="professional" />
                      </div>
                    </th>
                    <th className="text-left p-3">No IVAC Pro.</th>
                    <th className="text-left p-3">Service</th>
                    <th className="text-left p-3">Facture</th>
                    <th className="text-right p-3">Montant</th>
                    <th className="text-center p-3">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEntries.map((entry) => (
                    <tr key={entry.allocationId} className="border-b hover:bg-muted/30">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-foreground-muted" />
                          <div>
                            <div>{formatClinicDateShort(entry.appointmentDate)}</div>
                            <div className="text-xs text-foreground-muted">
                              {formatClinicTime(entry.appointmentDate)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-foreground-muted" />
                          <div>
                            <div className="font-medium">
                              {entry.clientLastName}, {entry.clientFirstName}
                            </div>
                            <div className="text-xs text-foreground-muted">
                              {entry.clientDisplayId}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="font-mono text-sm">{entry.ivacFileNumber || '-'}</span>
                      </td>
                      <td className="p-3">
                        <div>{entry.professionalDisplayName}</div>
                      </td>
                      <td className="p-3">
                        <span className="font-mono text-sm">
                          {entry.professionalIvacNumber || (
                            <span className="text-amber-600">Non configuré</span>
                          )}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="max-w-[200px] truncate" title={entry.serviceName}>
                          {entry.serviceName}
                        </div>
                      </td>
                      <td className="p-3">
                        <Link
                          to="/clients/$id"
                          params={{ id: entry.clientId }}
                          className="flex items-center gap-1 text-sage-600 hover:underline"
                        >
                          <FileText className="h-3 w-3" />
                          {entry.invoiceNumber}
                        </Link>
                      </td>
                      <td className="text-right p-3 font-medium">
                        {formatCentsCurrency(entry.amountCents)}
                      </td>
                      <td className="p-3 text-center">
                        <Badge
                          className={cn(
                            'text-xs',
                            PAYER_ALLOCATION_STATUS_COLORS[entry.status]
                          )}
                        >
                          {PAYER_ALLOCATION_STATUS_LABELS[entry.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

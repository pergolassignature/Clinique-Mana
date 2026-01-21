import { useState, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Plus,
  Users,
  Search,
  FileText,
  ChevronRight,
  Clock,
} from 'lucide-react'
import { t } from '@/i18n'
import { useProfessionals } from '@/professionals'
import type { ProfessionalStatus, ProfessionalListItem } from '@/professionals'
import { EmptyState } from '@/shared/components/empty-state'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Badge } from '@/shared/ui/badge'
import { Skeleton } from '@/shared/ui/skeleton'
import { Select } from '@/shared/ui/select'

const statusOptions: Array<{ value: ProfessionalStatus | 'all'; label: string }> = [
  { value: 'all', label: 'professionals.list.filters.all' },
  { value: 'pending', label: 'professionals.list.status.pending' },
  { value: 'invited', label: 'professionals.list.status.invited' },
  { value: 'active', label: 'professionals.list.status.active' },
  { value: 'inactive', label: 'professionals.list.status.inactive' },
]

function getStatusBadgeVariant(status: ProfessionalStatus): 'default' | 'secondary' | 'outline' | 'error' {
  switch (status) {
    case 'active':
      return 'default'
    case 'invited':
      return 'secondary'
    case 'pending':
      return 'outline'
    case 'inactive':
      return 'error'
    default:
      return 'outline'
  }
}

function ProfessionalCard({ professional }: { professional: ProfessionalListItem }) {
  const navigate = useNavigate()

  return (
    <button
      onClick={() => navigate({ to: '/professionnels/$id', params: { id: professional.id } })}
      className="group relative flex flex-col rounded-2xl border border-border bg-background p-5 text-left transition-all hover:border-sage-300 hover:shadow-medium"
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sage-100 text-sage-600">
          <span className="text-sm font-semibold">
            {professional.display_name
              .split(' ')
              .map((n) => n[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-foreground">
              {professional.display_name}
            </h3>
            <Badge variant={getStatusBadgeVariant(professional.status)} className="shrink-0">
              {t(`professionals.list.status.${professional.status}` as Parameters<typeof t>[0])}
            </Badge>
          </div>
          <p className="truncate text-sm text-foreground-muted">
            {professional.email}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-4 flex items-center gap-4 text-sm text-foreground-muted">
        <span className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          {professional.specialty_count} {t('professionals.list.card.specialties')}
        </span>
        <span className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          {professional.document_count} {t('professionals.list.card.documents')}
        </span>
      </div>

      {/* Pending invite indicator */}
      {professional.has_pending_invite && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-honey-600">
          <Clock className="h-3.5 w-3.5" />
          {t('professionals.list.card.pendingInvite')}
        </div>
      )}

      {/* View button */}
      <div className="mt-4 flex items-center justify-end text-sm font-medium text-sage-600 opacity-0 transition-opacity group-hover:opacity-100">
        {t('professionals.list.card.viewProfile')}
        <ChevronRight className="ml-1 h-4 w-4" />
      </div>
    </button>
  )
}

function ProfessionalCardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-background p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-1 h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-5 w-16" />
      </div>
      <div className="mt-4 flex items-center gap-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-24" />
      </div>
    </div>
  )
}

export function ProfessionalsPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProfessionalStatus | 'all'>('all')

  const filters = useMemo(
    () => ({
      status: statusFilter === 'all' ? undefined : statusFilter,
      search: search || undefined,
    }),
    [search, statusFilter]
  )

  const { data: professionals, isLoading, error } = useProfessionals(filters)

  const hasFilters = search || statusFilter !== 'all'
  const isEmpty = !isLoading && (!professionals || professionals.length === 0)

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Filters */}
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          {/* Search */}
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
            <Input
              type="text"
              placeholder={t('professionals.list.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Status filter */}
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ProfessionalStatus | 'all')}
            className="w-full sm:w-40"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label as Parameters<typeof t>[0])}
              </option>
            ))}
          </Select>
        </div>

        {/* Action button - TODO: Add route for /professionnels/nouveau */}
        <Button disabled>
          <Plus className="h-4 w-4" />
          {t('professionals.list.addProfessional')}
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <ProfessionalCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title={t('common.error')}
          description={t('errors.somethingWrong')}
          action={
            <Button variant="outline" onClick={() => window.location.reload()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : isEmpty ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title={
            hasFilters
              ? t('professionals.list.empty.filteredTitle')
              : t('professionals.list.empty.title')
          }
          description={
            hasFilters
              ? t('professionals.list.empty.filteredDescription')
              : t('professionals.list.empty.description')
          }
          action={
            hasFilters ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSearch('')
                  setStatusFilter('all')
                }}
              >
                {t('common.retry')}
              </Button>
            ) : (
              <Button disabled>
                <Plus className="h-4 w-4" />
                {t('professionals.list.addProfessional')}
              </Button>
            )
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {professionals?.map((professional) => (
            <ProfessionalCard key={professional.id} professional={professional} />
          ))}
        </div>
      )}
    </div>
  )
}

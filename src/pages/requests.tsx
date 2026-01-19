import { Link } from '@tanstack/react-router'
import { Plus, Inbox } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/empty-state'
import { FilterBarSkeleton } from '@/shared/components/filter-bar-skeleton'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'

export function RequestsPage() {
  const isEmpty = true

  return (
    <div className="space-y-6">
      {/* Toolbar: Status chips + Action */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="default" className="cursor-pointer">
            {t('filters.all')}
          </Badge>
          <Badge variant="outline" className="cursor-pointer opacity-60">
            {t('filters.pending')}
          </Badge>
          <Badge variant="outline" className="cursor-pointer opacity-60">
            {t('filters.confirmed')}
          </Badge>
          <Badge variant="outline" className="cursor-pointer opacity-60">
            {t('filters.cancelled')}
          </Badge>
        </div>
        <Button asChild className="shrink-0">
          <Link to="/demandes/$id" params={{ id: 'nouvelle' }} search={{ from: 'requests' }}>
            <Plus className="h-4 w-4" />
            {t('pages.requests.action')}
          </Link>
        </Button>
      </div>

      {/* Filter Bar */}
      <FilterBarSkeleton filters={3} showSearch />

      {/* Content */}
      {isEmpty ? (
        <EmptyState
          icon={<Inbox className="h-8 w-8" />}
          title={t('pages.requests.empty.title')}
          description={t('pages.requests.empty.description')}
        />
      ) : (
        /* Request cards skeleton */
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-4 rounded-xl border border-border bg-background p-4"
            >
              <div className="shimmer h-12 w-12 rounded-full shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="shimmer h-5 w-40 rounded" />
                  <div className="shimmer h-6 w-20 rounded-lg" />
                </div>
                <div className="shimmer h-4 w-64 rounded" />
                <div className="flex gap-4">
                  <div className="shimmer h-4 w-24 rounded" />
                  <div className="shimmer h-4 w-24 rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

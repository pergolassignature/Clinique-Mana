import { Plus, Calendar } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/empty-state'
import { FilterBarSkeleton } from '@/shared/components/filter-bar-skeleton'
import { Button } from '@/shared/ui/button'

export function AvailabilityPage() {
  const isEmpty = true

  return (
    <div className="space-y-6">
      {/* Toolbar: Action button */}
      <div className="flex justify-end">
        <Button disabled>
          <Plus className="h-4 w-4" />
          {t('pages.availability.action')}
        </Button>
      </div>

      {/* Filter Bar */}
      <FilterBarSkeleton filters={4} showSearch={false} />

      {/* Week selector skeleton */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-background p-4">
        <div className="shimmer h-9 w-9 rounded-lg" />
        <div className="flex items-center gap-3">
          <div className="shimmer h-5 w-32 rounded" />
        </div>
        <div className="shimmer h-9 w-9 rounded-lg" />
      </div>

      {/* Content */}
      {isEmpty ? (
        <EmptyState
          icon={<Calendar className="h-8 w-8" />}
          title={t('pages.availability.empty.title')}
          description={t('pages.availability.empty.description')}
        />
      ) : (
        /* Calendar grid skeleton */
        <div className="rounded-xl border border-border bg-background overflow-hidden">
          {/* Days header */}
          <div className="grid grid-cols-7 border-b border-border bg-background-secondary">
            {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day) => (
              <div
                key={day}
                className="border-r border-border last:border-r-0 px-2 py-3 text-center text-sm font-medium text-foreground-secondary"
              >
                {day}
              </div>
            ))}
          </div>
          {/* Time slots skeleton */}
          <div className="grid grid-cols-7 divide-x divide-border">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="min-h-[300px] p-2 space-y-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div
                    key={j}
                    className="shimmer h-12 rounded-lg"
                    style={{ animationDelay: `${(i * 3 + j) * 50}ms` }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

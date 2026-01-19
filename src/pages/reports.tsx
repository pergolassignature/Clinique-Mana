import { Download, BarChart3 } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/empty-state'
import { FilterBarSkeleton } from '@/shared/components/filter-bar-skeleton'
import { Button } from '@/shared/ui/button'

export function ReportsPage() {
  const isEmpty = true

  return (
    <div className="space-y-6">
      {/* Toolbar: Action button */}
      <div className="flex justify-end">
        <Button disabled>
          <Download className="h-4 w-4" />
          {t('pages.reports.action')}
        </Button>
      </div>

      {/* Date range filter */}
      <FilterBarSkeleton filters={2} showSearch={false} />

      {/* Content */}
      {isEmpty ? (
        <EmptyState
          icon={<BarChart3 className="h-8 w-8" />}
          title={t('pages.reports.empty.title')}
          description={t('pages.reports.empty.description')}
        />
      ) : (
        /* Charts skeleton */
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Bar chart placeholder */}
          <div className="rounded-xl border border-border bg-background p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="shimmer h-5 w-40 rounded" />
              <div className="shimmer h-8 w-24 rounded-lg" />
            </div>
            <div className="flex items-end justify-between gap-2 h-48">
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 shimmer rounded-t-lg"
                  style={{
                    height: `${30 + Math.random() * 70}%`,
                    animationDelay: `${i * 100}ms`,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Line chart placeholder */}
          <div className="rounded-xl border border-border bg-background p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="shimmer h-5 w-40 rounded" />
              <div className="shimmer h-8 w-24 rounded-lg" />
            </div>
            <div className="relative h-48">
              <div className="shimmer absolute inset-0 rounded-lg" />
            </div>
          </div>

          {/* Stats cards */}
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-background p-5"
            >
              <div className="shimmer h-4 w-24 rounded mb-2" />
              <div className="shimmer h-8 w-16 rounded mb-3" />
              <div className="shimmer h-3 w-32 rounded" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

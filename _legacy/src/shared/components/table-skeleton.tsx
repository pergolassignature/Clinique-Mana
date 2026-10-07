import { cn } from '@/shared/lib/utils'

interface TableSkeletonProps {
  columns?: number
  rows?: number
  className?: string
}

export function TableSkeleton({
  columns = 5,
  rows = 5,
  className,
}: TableSkeletonProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-background',
        className
      )}
    >
      {/* Header */}
      <div className="border-b border-border bg-background-secondary px-4 py-3">
        <div className="flex gap-4">
          {Array.from({ length: columns }).map((_, i) => (
            <div
              key={i}
              className="shimmer h-4 rounded"
              style={{ width: `${100 / columns - 2}%` }}
            />
          ))}
        </div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4 px-4 py-4">
            {Array.from({ length: columns }).map((_, colIndex) => (
              <div
                key={colIndex}
                className="shimmer h-4 rounded"
                style={{
                  width: `${100 / columns - 2}%`,
                  animationDelay: `${(rowIndex * columns + colIndex) * 50}ms`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function CardGridSkeleton({
  cards = 6,
  className,
}: {
  cards?: number
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid gap-4 sm:grid-cols-2 lg:grid-cols-3',
        className
      )}
    >
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-background p-4"
        >
          <div className="flex items-start gap-3">
            <div
              className="shimmer h-10 w-10 shrink-0 rounded-full"
              style={{ animationDelay: `${i * 100}ms` }}
            />
            <div className="flex-1 space-y-2">
              <div
                className="shimmer h-4 w-3/4 rounded"
                style={{ animationDelay: `${i * 100 + 50}ms` }}
              />
              <div
                className="shimmer h-3 w-1/2 rounded"
                style={{ animationDelay: `${i * 100 + 100}ms` }}
              />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div
              className="shimmer h-3 w-full rounded"
              style={{ animationDelay: `${i * 100 + 150}ms` }}
            />
            <div
              className="shimmer h-3 w-2/3 rounded"
              style={{ animationDelay: `${i * 100 + 200}ms` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

import { cn } from '@/shared/lib/utils'

interface FilterBarSkeletonProps {
  filters?: number
  showSearch?: boolean
  className?: string
}

export function FilterBarSkeleton({
  filters = 3,
  showSearch = true,
  className,
}: FilterBarSkeletonProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-3',
        className
      )}
    >
      {/* Search input skeleton */}
      {showSearch && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background-secondary px-3 py-2">
          <div className="shimmer h-4 w-4 rounded" />
          <div className="shimmer h-4 w-32 rounded" />
        </div>
      )}

      {/* Filter chips/dropdowns skeleton */}
      {Array.from({ length: filters }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-lg border border-border bg-background-secondary px-3 py-2"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div
            className="shimmer h-4 rounded"
            style={{ width: `${60 + Math.random() * 40}px` }}
          />
          <div className="shimmer h-4 w-4 rounded" />
        </div>
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Action buttons skeleton */}
      <div className="flex items-center gap-2">
        <div className="shimmer h-9 w-24 rounded-lg" />
      </div>
    </div>
  )
}

export function ChipsSkeleton({
  chips = 4,
  className,
}: {
  chips?: number
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {Array.from({ length: chips }).map((_, i) => (
        <div
          key={i}
          className="shimmer h-8 rounded-lg"
          style={{
            width: `${60 + Math.random() * 50}px`,
            animationDelay: `${i * 80}ms`,
          }}
        />
      ))}
    </div>
  )
}

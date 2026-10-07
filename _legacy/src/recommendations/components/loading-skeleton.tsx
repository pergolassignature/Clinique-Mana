// src/recommendations/components/loading-skeleton.tsx
// Loading skeleton for recommendations panel

import { Skeleton } from '@/shared/ui/skeleton'

/**
 * Loading skeleton for the recommendations panel.
 * Matches the layout of recommendation cards.
 */
export function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {/* AI Summary skeleton */}
      <div className="rounded-lg border border-border bg-background-secondary/30 p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-5 w-5 shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </div>

      {/* Recommendation cards skeleton */}
      {[1, 2, 3].map((index) => (
        <RecommendationCardSkeleton key={index} />
      ))}

      {/* Near-eligible section skeleton */}
      <div className="rounded-lg border border-dashed border-border p-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
    </div>
  )
}

/**
 * Skeleton for a single recommendation card.
 */
export function RecommendationCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-start gap-4">
        {/* Rank badge */}
        <Skeleton className="h-8 w-8 rounded-full shrink-0" />

        {/* Avatar */}
        <Skeleton className="h-12 w-12 rounded-full shrink-0" />

        {/* Content */}
        <div className="flex-1 space-y-3">
          {/* Name and score */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>

          {/* AI reasoning bullets */}
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>

          {/* Matched motifs */}
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-20 rounded-lg" />
            <Skeleton className="h-5 w-24 rounded-lg" />
            <Skeleton className="h-5 w-16 rounded-lg" />
          </div>

          {/* Availability and actions */}
          <div className="flex items-center justify-between pt-2">
            <Skeleton className="h-4 w-40" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-24 rounded-xl" />
              <Skeleton className="h-8 w-28 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

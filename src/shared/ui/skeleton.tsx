import { cn } from '@/shared/lib/utils'

type SkeletonProps = React.HTMLAttributes<HTMLDivElement>

/** Loading placeholder: radius 4, 20 % muted grey, 2s pulse. Decorative: announce loading elsewhere. */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-md bg-subtle/20 motion-reduce:animate-none',
        className
      )}
      {...props}
    />
  )
}

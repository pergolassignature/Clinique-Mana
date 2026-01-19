import { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background-secondary/50 px-6 py-16 text-center',
        className
      )}
    >
      {/* Illustration placeholder */}
      {icon ? (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-sage-100 text-sage-500">
          {icon}
        </div>
      ) : (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-sage-100">
          <svg
            className="h-8 w-8 text-sage-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
        </div>
      )}

      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-foreground-secondary">
        {description}
      </p>

      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

import { ReactNode } from 'react'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  action?: {
    label: string
    onClick?: () => void
    icon?: ReactNode
    disabled?: boolean
  }
  className?: string
}

export function PageHeader({
  title,
  subtitle,
  action,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div>
        <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-sm text-foreground-secondary">{subtitle}</p>
        )}
      </div>
      {action && (
        <Button
          onClick={action.onClick}
          disabled={action.disabled}
          className="shrink-0"
        >
          {action.icon}
          {action.label}
        </Button>
      )}
    </div>
  )
}

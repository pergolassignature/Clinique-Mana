import { CircleAlert, CircleCheck, Clock } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'

export type StatusIndicatorStatus = 'complete' | 'pending' | 'warning'

const statuses = {
  complete: { Icon: CircleCheck, className: 'text-success', label: 'common.status.complete' },
  pending: { Icon: Clock, className: 'text-warning-strong', label: 'common.status.pending' },
  warning: { Icon: CircleAlert, className: 'text-destructive', label: 'common.status.warning' },
} as const

interface StatusIndicatorProps {
  label: string
  status?: StatusIndicatorStatus
  /** 12px secondary text on the same baseline (e.g. « Envoyé le 3 oct. »). */
  description?: string
  className?: string
}

/**
 * A checklist row (professional onboarding): coloured 14px icon, label, optional description,
 * hairline separator. The icon is decorative; screen readers hear the status as words.
 */
export function StatusIndicator({ label, status = 'pending', description, className }: StatusIndicatorProps) {
  const { Icon, className: tone, label: statusKey } = statuses[status]
  return (
    <div className={cn('flex items-start gap-2 border-b border-border-light py-1.5', className)} data-status={status}>
      <Icon aria-hidden className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', tone)} />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <p className="text-sm text-foreground">
          {label}
          <span className="sr-only"> {t(statusKey)}</span>
        </p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  )
}

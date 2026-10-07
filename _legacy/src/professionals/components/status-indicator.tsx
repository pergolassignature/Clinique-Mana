import { CheckCircle, AlertCircle, Clock } from 'lucide-react'

export type StatusIndicatorStatus = 'complete' | 'pending' | 'warning'

interface StatusIndicatorProps {
  label: string
  status: StatusIndicatorStatus
  description?: string
}

export function StatusIndicator({ label, status, description }: StatusIndicatorProps) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-background-secondary/50 p-3">
      <div
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          status === 'complete'
            ? 'bg-sage-100 text-sage-600'
            : status === 'warning'
              ? 'bg-wine-100 text-wine-600'
              : 'bg-honey-100 text-honey-600'
        }`}
      >
        {status === 'complete' ? (
          <CheckCircle className="h-3.5 w-3.5" />
        ) : status === 'warning' ? (
          <AlertCircle className="h-3.5 w-3.5" />
        ) : (
          <Clock className="h-3.5 w-3.5" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && (
          <p className="mt-0.5 text-xs text-foreground-muted">{description}</p>
        )}
      </div>
    </div>
  )
}

import { cn } from '@/shared/lib/utils'

export type StatusTone = 'default' | 'neutral' | 'success' | 'warning' | 'error' | 'info'

const toneClasses: Record<StatusTone, string> = {
  default: 'bg-muted-foreground',
  neutral: 'bg-neutral',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-destructive',
  // The handoff draws « info » with the success teal (teal-500).
  info: 'bg-success',
}

interface StatusDotProps {
  tone?: StatusTone
  className?: string
}

/**
 * The design system's status mark: a 6px dot, always next to a word that carries the meaning
 * (the dot is decorative and hidden from screen readers). See Badge.
 */
export function StatusDot({ tone = 'default', className }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', toneClasses[tone], className)}
    />
  )
}

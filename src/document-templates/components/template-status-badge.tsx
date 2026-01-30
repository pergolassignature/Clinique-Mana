import { Badge } from '@/shared/ui/badge'
import type { TemplateStatus } from '../types'

const statusConfig: Record<
  TemplateStatus,
  { variant: 'secondary' | 'success' | 'default'; label: string }
> = {
  draft: { variant: 'secondary', label: 'Brouillon' },
  published: { variant: 'success', label: 'Publie' },
  archived: { variant: 'default', label: 'Archive' },
}

interface TemplateStatusBadgeProps {
  status: TemplateStatus
  className?: string
}

export function TemplateStatusBadge({ status, className }: TemplateStatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  )
}

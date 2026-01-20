import { Lock } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'

interface MotifRestrictionNoticeProps {
  onLearnMore?: () => void
  className?: string
}

export function MotifRestrictionNotice({
  onLearnMore,
  className,
}: MotifRestrictionNoticeProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-lg border border-honey-200 bg-honey-50/50 px-4 py-3',
        className
      )}
    >
      <Lock className="h-4 w-4 shrink-0 mt-0.5 text-honey-600" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          {t('pages.motifs.restrictions.title')}
        </p>
        <p className="text-xs text-foreground-secondary mt-0.5">
          {t('pages.motifs.restrictions.explanation')}
        </p>
        {onLearnMore && (
          <Button
            variant="link"
            size="sm"
            onClick={onLearnMore}
            className="h-auto p-0 mt-1.5 text-xs text-honey-700 hover:text-honey-800"
          >
            {t('pages.motifs.restrictions.learnMore')}
          </Button>
        )}
      </div>
    </div>
  )
}

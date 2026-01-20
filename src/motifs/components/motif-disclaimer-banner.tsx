import { Info } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { t } from '@/i18n'

interface MotifDisclaimerBannerProps {
  variant?: 'info' | 'subtle'
  className?: string
}

export function MotifDisclaimerBanner({
  variant = 'info',
  className,
}: MotifDisclaimerBannerProps) {
  return (
    <div
      role="note"
      aria-label={t('pages.motifs.disclaimer.ariaLabel')}
      className={cn(
        'flex items-start gap-3 rounded-lg px-4 py-3',
        variant === 'info' && 'border-l-2 border-sage-300 bg-sage-50/50',
        variant === 'subtle' && 'bg-background-secondary/50',
        className
      )}
    >
      <Info
        className={cn(
          'h-4 w-4 shrink-0 mt-0.5',
          variant === 'info' ? 'text-sage-500' : 'text-foreground-muted'
        )}
      />
      <p
        className={cn(
          'text-sm leading-relaxed',
          variant === 'info' ? 'text-foreground-secondary' : 'text-foreground-muted'
        )}
      >
        {t('pages.motifs.disclaimer.text')}
      </p>
    </div>
  )
}

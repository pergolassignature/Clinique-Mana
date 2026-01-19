// src/services-catalog/components/service-disclaimer-banner.tsx

import { Info } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'

interface ServiceDisclaimerBannerProps {
  className?: string
}

export function ServiceDisclaimerBanner({ className }: ServiceDisclaimerBannerProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border border-sage-200/60 bg-sage-50/50 p-4',
        className
      )}
    >
      <Info className="h-5 w-5 shrink-0 text-sage-600 mt-0.5" />
      <p className="text-sm text-sage-700">
        {t('pages.services.disclaimer.message')}
      </p>
    </div>
  )
}

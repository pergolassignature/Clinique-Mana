import { Logo } from '@/assets/logo'
import { t } from '@/i18n'

export function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6">
        <Logo />
        <div className="flex items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-sage-200 border-t-sage-600" />
          <span className="text-sm text-foreground-secondary">
            {t('common.loading')}
          </span>
        </div>
      </div>
    </div>
  )
}

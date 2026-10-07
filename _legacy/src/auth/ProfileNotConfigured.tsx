import { Logo } from '@/assets/logo'
import { Button } from '@/shared/ui/button'
import { t } from '@/i18n'

interface ProfileNotConfiguredProps {
  onRetry: () => void
}

export function ProfileNotConfigured({ onRetry }: ProfileNotConfiguredProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-border bg-background-secondary p-8">
          <h1 className="text-xl font-semibold text-foreground">
            {t('auth.profileNotConfigured.title')}
          </h1>
          <p className="mt-3 text-foreground-secondary">
            {t('auth.profileNotConfigured.description')}
          </p>
          <Button onClick={onRetry} variant="outline" className="mt-6">
            {t('auth.profileNotConfigured.retry')}
          </Button>
        </div>
      </div>
    </div>
  )
}

import { Link } from '@tanstack/react-router'
import { Home, Search } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      {/* Illustration */}
      <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-sage-100">
        <Search className="h-12 w-12 text-sage-400" />
      </div>

      {/* Text */}
      <h1 className="text-2xl font-semibold text-foreground">
        {t('errors.pageNotFound')}
      </h1>
      <p className="mt-2 max-w-md text-foreground-secondary">
        {t('errors.pageNotFoundDescription')}
      </p>

      {/* Action */}
      <Button asChild className="mt-6">
        <Link to="/dashboard">
          <Home className="mr-2 h-4 w-4" />
          {t('errors.goHome')}
        </Link>
      </Button>
    </div>
  )
}

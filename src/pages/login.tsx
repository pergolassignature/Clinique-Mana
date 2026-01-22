import { useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Logo } from '@/assets/logo'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useAuth, ProfileNotConfigured } from '@/auth'
import { t } from '@/i18n'
import type { AuthError } from '@/auth'

export function LoginPage() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/connexion' })
  const { signIn, error: authError, isLoading } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<AuthError | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const error = localError || authError

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)
    setIsSubmitting(true)

    const { error: signInError } = await signIn(email, password)

    if (signInError) {
      setLocalError(signInError)
      setIsSubmitting(false)
      return
    }

    // Redirect to original destination or dashboard
    // Filter out /connexion to prevent redirect loops
    const rawRedirect = (search as { redirect?: string }).redirect
    const redirectTo = rawRedirect && rawRedirect !== '/connexion' ? rawRedirect : '/dashboard'
    navigate({ to: redirectTo })
  }

  const handleRetry = () => {
    setLocalError(null)
    setEmail('')
    setPassword('')
  }

  // Show profile not configured screen
  if (error === 'profile_not_found') {
    return <ProfileNotConfigured onRetry={handleRetry} />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="rounded-2xl border border-border bg-background-secondary p-8">
          <h1 className="text-center text-2xl font-semibold text-foreground">
            {t('auth.login.title')}
          </h1>
          <p className="mt-2 text-center text-sm text-foreground-secondary">
            {t('auth.login.subtitle')}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-sm font-medium text-foreground"
              >
                {t('auth.login.email')}
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.login.emailPlaceholder')}
                required
                autoComplete="email"
                disabled={isSubmitting || isLoading}
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-sm font-medium text-foreground"
              >
                {t('auth.login.password')}
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.login.passwordPlaceholder')}
                required
                autoComplete="current-password"
                disabled={isSubmitting || isLoading}
              />
            </div>

            {error && (
              <div className="rounded-lg bg-wine-50 px-4 py-3 text-sm text-wine-700">
                {getErrorMessage(error)}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || isLoading}
            >
              {isSubmitting ? t('auth.login.signingIn') : t('auth.login.signIn')}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-foreground-muted">
          {t('auth.login.helpText')}
        </p>
      </div>
    </div>
  )
}

function getErrorMessage(error: AuthError): string {
  switch (error) {
    case 'invalid_credentials':
      return t('auth.errors.invalidCredentials')
    case 'profile_disabled':
      return t('auth.errors.profileDisabled')
    default:
      return t('auth.errors.unknown')
  }
}

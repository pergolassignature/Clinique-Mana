import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useLocation } from 'react-router-dom'
import { t } from '@/i18n'
import { useAuth, type AuthErrorCode } from '@/core/auth/auth-context'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { AuthCard, StatusNotice } from './AuthCard'

const schema = z.object({ email: z.email({ error: t('auth.errors.invalidEmail') }) })
type Values = z.infer<typeof schema>

export function ForgotPasswordPage() {
  usePageTitle(t('pageTitles.forgot'))
  const { sendPasswordReset } = useAuth()
  // Sent here by the reset page when the recovery session could no longer be used.
  const expired = (useLocation().state as { expired?: boolean } | null)?.expired === true
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<AuthErrorCode | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) })

  // The form disappears on success: move focus to the heading instead of losing it. Not to the
  // message itself — the live region already announces it, and focusing it would read it twice.
  useEffect(() => {
    if (sent) headingRef.current?.focus()
  }, [sent])

  // Success is always the same neutral message: never reveal whether an account exists. Errors
  // (rate_limited, unknown) are shown — neither depends on the account (see AuthProvider).
  const onSubmit = async ({ email }: Values) => {
    setError(null)
    const code = await sendPasswordReset(email)
    if (code) setError(code)
    else setSent(true)
  }

  return (
    <AuthCard
      title={t('auth.forgot.title')}
      headingRef={headingRef}
      subtitle={sent ? undefined : t('auth.forgot.subtitle')}
      status={
        sent ? <StatusNotice>{t('auth.forgot.sent')}</StatusNotice> : null
      }
    >
      {expired && !sent && <p className="mb-4 text-sm text-foreground">{t('auth.reset.invalidLink')}</p>}
      {!sent && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('auth.login.email')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={Boolean(formState.errors.email)}
              aria-describedby={formState.errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
            {formState.errors.email && <p id="email-error" className="text-xs text-destructive">{formState.errors.email.message}</p>}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{t(`auth.errors.${error}`)}</p>}
          <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
            {t('auth.forgot.submit')}
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm">
        <Link to="/connexion" className="text-primary hover:underline">
          {t('auth.forgot.back')}
        </Link>
      </p>
    </AuthCard>
  )
}

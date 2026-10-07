import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { t } from '@/i18n'
import { useAuth, type AuthErrorCode } from '@/core/auth/auth-context'
import { safeRedirect } from '@/core/auth/redirect'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { AuthCard, StatusNotice } from './AuthCard'

const schema = z.object({
  email: z.email({ error: t('auth.errors.invalidEmail') }),
  password: z.string().min(1, { error: t('auth.errors.required') }),
})
type Values = z.infer<typeof schema>

export function LoginPage() {
  const { session, isLoading, signInWithPassword, sendMagicLink } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<AuthErrorCode | null>(null)
  const [magicSent, setMagicSent] = useState(false)
  const [magicPending, setMagicPending] = useState(false)
  const { register, handleSubmit, getValues, trigger, resetField, setFocus, formState } = useForm<Values>({
    resolver: zodResolver(schema),
  })
  // Where to go after sign-in; also where the magic link lands. Never an external URL.
  const target = safeRedirect(params.get('redirect'))

  if (session) return <Navigate to={target} replace />

  if (isLoading) return <AuthCard title={t('auth.login.title')} status={<StatusNotice muted>{t('common.loading')}</StatusNotice>} />

  const onSubmit = async ({ email, password }: Values) => {
    setError(null)
    setMagicSent(false)
    const code = await signInWithPassword(email, password)
    if (!code) {
      navigate(target, { replace: true })
      return
    }
    setError(code)
    if (code === 'invalid_credentials') {
      resetField('password')
      setFocus('password')
    }
  }

  const onMagicLink = async () => {
    // Pending first (the button disables on this click), so a double click sends one link.
    setMagicPending(true)
    try {
      if (!(await trigger('email'))) return
      setError(null)
      setMagicSent(false)
      const code = await sendMagicLink(getValues('email'), target)
      if (code) setError(code)
      else setMagicSent(true)
    } finally {
      setMagicPending(false)
    }
  }

  const busy = formState.isSubmitting || magicPending

  return (
    <AuthCard
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      status={magicSent ? <StatusNotice>{t('auth.login.magicLinkSent')}</StatusNotice> : null}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="email">{t('auth.login.email')}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(formState.errors.email)}
            aria-describedby={formState.errors.email ? 'email-error' : undefined}
            {...register('email')}
          />
          {formState.errors.email && <p id="email-error" className="text-xs text-destructive">{formState.errors.email.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('auth.login.password')}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={Boolean(formState.errors.password)}
            aria-describedby={formState.errors.password ? 'password-error' : undefined}
            {...register('password')}
          />
          {formState.errors.password && <p id="password-error" className="text-xs text-destructive">{formState.errors.password.message}</p>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{t(`auth.errors.${error}`)}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {t('auth.login.submit')}
        </Button>
        <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          {t('auth.login.or')}
          <span className="h-px flex-1 bg-border" />
        </div>
        <Button type="button" variant="outline" className="w-full whitespace-normal" onClick={onMagicLink} disabled={busy}>
          {t('auth.login.magicLink')}
        </Button>
        <p className="text-center text-sm">
          <Link to="/mot-de-passe-oublie" className="text-primary hover:underline">
            {t('auth.login.forgot')}
          </Link>
        </p>
      </form>
    </AuthCard>
  )
}

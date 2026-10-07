import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { useAuth, type AuthErrorCode } from '@/core/auth/auth-context'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { toast } from '@/shared/ui/sonner'
import { AuthCard, StatusNotice } from './AuthCard'

const schema = z
  .object({
    password: z
      .string()
      .min(10, { error: t('auth.reset.tooShort') })
      // bcrypt (GoTrue) only uses the first 72 bytes; accented letters take two.
      .refine((v) => new TextEncoder().encode(v).length <= 72, { error: t('auth.reset.tooLong') }),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], error: t('auth.reset.mismatch') })
type Values = z.infer<typeof schema>

/**
 * Lands here from the recovery email. Not under RequireAuth: the guard sends recovery sessions
 * here, and they must be able to stay. Serves only a real recovery session.
 */
export function ResetPasswordPage() {
  const { session, isLoading, isRecovery, updatePassword, signOut } = useAuth()
  const { hash } = useLocation()
  const navigate = useNavigate()
  // An expired or already used link lands with #error_code=… (auth-js keeps any existing session).
  const linkFailed = new URLSearchParams(hash.slice(1)).has('error_code')
  const [error, setError] = useState<AuthErrorCode | null>(null)
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) })

  if (isLoading) return <AuthCard title={t('auth.reset.title')} status={<StatusNotice muted>{t('common.loading')}</StatusNotice>} />

  // The recovery link signs the user in; without a session the link was invalid or expired.
  if (linkFailed || !session) {
    return (
      <AuthCard title={t('auth.reset.title')}>
        <p className="text-sm text-muted-foreground">{t('auth.reset.invalidLink')}</p>
        <div className="mt-4 flex flex-col items-center gap-2 text-sm">
          <Link to="/mot-de-passe-oublie" className="text-primary hover:underline">
            {t('auth.reset.requestNew')}
          </Link>
          {session && (
            <Link to="/accueil" className="text-primary hover:underline">
              {t('auth.reset.backHome')}
            </Link>
          )}
        </div>
      </AuthCard>
    )
  }

  // An ordinary session has nothing to do here.
  if (!isRecovery) return <Navigate to="/accueil" replace />

  const onSubmit = async ({ password }: Values) => {
    setError(null)
    const code = await updatePassword(password)
    if (code === 'reauthentication_needed') {
      // No trap: this recovery session can no longer change the password. Start over.
      await signOut()
      navigate('/mot-de-passe-oublie', { replace: true, state: { expired: true } })
      return
    }
    if (code) {
      setError(code)
      return
    }
    toast.success(t('auth.reset.success'))
    navigate('/accueil', { replace: true })
  }

  const onCancel = async () => {
    await signOut()
    navigate('/connexion', { replace: true })
  }

  return (
    <AuthCard title={t('auth.reset.title')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {/* Tells password managers which account the new password belongs to. */}
        <input type="text" name="username" autoComplete="username" value={session.user.email ?? ''} readOnly hidden />
        <div className="space-y-1.5">
          <Label htmlFor="password">{t('auth.reset.password')}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(formState.errors.password)}
            aria-describedby={formState.errors.password ? 'password-error' : undefined}
            {...register('password')}
          />
          {formState.errors.password && <p id="password-error" className="text-xs text-destructive">{formState.errors.password.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">{t('auth.reset.confirm')}</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(formState.errors.confirm)}
            aria-describedby={formState.errors.confirm ? 'confirm-error' : undefined}
            {...register('confirm')}
          />
          {formState.errors.confirm && <p id="confirm-error" className="text-xs text-destructive">{formState.errors.confirm.message}</p>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{t(`auth.errors.${error}`)}</p>}
        <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
          {t('auth.reset.submit')}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={onCancel} disabled={formState.isSubmitting}>
          {t('auth.reset.cancel')}
        </Button>
      </form>
    </AuthCard>
  )
}

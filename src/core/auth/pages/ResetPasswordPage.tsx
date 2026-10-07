import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { useAuth, type AuthErrorCode } from '@/core/auth/auth-context'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { toast } from '@/shared/ui/sonner'
import { AuthCard } from './AuthCard'

const schema = z
  .object({
    password: z.string().min(10, { error: t('auth.reset.tooShort') }),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], error: t('auth.reset.mismatch') })
type Values = z.infer<typeof schema>

/**
 * Lands here from the recovery email (not under RequireAuth: a recovery session is sent here by
 * the guard, and must be able to stay). Also usable by a signed-in user to change their password.
 */
export function ResetPasswordPage() {
  const { session, isLoading, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<AuthErrorCode | null>(null)
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) })

  if (isLoading) {
    return (
      <AuthCard title={t('auth.reset.title')}>
        <p role="status" className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </AuthCard>
    )
  }

  // The recovery link signs the user in; without a session the link was invalid or expired.
  if (!session) {
    return (
      <AuthCard title={t('auth.reset.title')}>
        <p className="text-sm text-muted-foreground">{t('auth.reset.invalidLink')}</p>
        <p className="mt-4 text-center text-sm">
          <Link to="/mot-de-passe-oublie" className="text-primary hover:underline">
            {t('auth.reset.requestNew')}
          </Link>
        </p>
      </AuthCard>
    )
  }

  const onSubmit = async ({ password }: Values) => {
    setError(null)
    const code = await updatePassword(password)
    if (code) {
      setError(code)
      return
    }
    toast.success(t('auth.reset.success'))
    navigate('/accueil', { replace: true })
  }

  return (
    <AuthCard title={t('auth.reset.title')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
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
      </form>
    </AuthCard>
  )
}

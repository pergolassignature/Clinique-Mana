import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { useAuth } from '@/core/auth/auth-context'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { AuthCard } from './AuthCard'

const schema = z.object({ email: z.email({ error: t('auth.errors.invalidEmail') }) })
type Values = z.infer<typeof schema>

export function ForgotPasswordPage() {
  const { sendPasswordReset } = useAuth()
  const [sent, setSent] = useState(false)
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) })

  // Always the same neutral message, whatever the result: never reveal whether an account exists.
  const onSubmit = async ({ email }: Values) => {
    await sendPasswordReset(email)
    setSent(true)
  }

  return (
    <AuthCard title={t('auth.forgot.title')} subtitle={sent ? undefined : t('auth.forgot.subtitle')}>
      {sent ? (
        <p role="status" className="rounded-md bg-primary/10 px-3 py-2 text-sm text-foreground">
          {t('auth.forgot.sent')}
        </p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('auth.login.email')}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(formState.errors.email)}
              aria-describedby={formState.errors.email ? 'email-error' : undefined}
              {...register('email')}
            />
            {formState.errors.email && <p id="email-error" className="text-xs text-destructive">{formState.errors.email.message}</p>}
          </div>
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

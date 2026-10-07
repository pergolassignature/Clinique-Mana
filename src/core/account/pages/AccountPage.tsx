import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CircleAlert, MailCheck } from 'lucide-react'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import { accountKeys, useAuthUser, useUpdateDisplayName } from '@/core/account/hooks'
import { useAuth, type AuthErrorCode } from '@/core/auth/auth-context'
import { newPasswordRule, passwordMismatch, passwordsMatch } from '@/core/auth/password-schema'
import { PageHeader } from '@/shared/components/PageHeader'
import { SaveButton } from '@/shared/components/SaveButton'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { toast } from '@/shared/ui/sonner'

/** An auth failure that belongs to no field, announced when it appears. */
function ErrorAlert({ title, code }: { title?: string; code: AuthErrorCode }) {
  return (
    <Alert variant="destructive" role="alert">
      <CircleAlert aria-hidden />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription>{t(`auth.errors.${code}`)}</AlertDescription>
    </Alert>
  )
}

/**
 * The signed-in user, as the server has it when known: the stored session lags behind an email
 * change confirmed elsewhere (another device) until its next token refresh.
 */
function useAccountUser() {
  const { session } = useAuth()
  const { user_id } = useReadyAccess()
  return useAuthUser(user_id).data ?? session?.user
}

// ── Nom affiché ─────────────────────────────────────────────────────────────────────────────────

const NAME_MAX = 80
const nameSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, { error: t('settings.validation.nameRequired') })
    .max(NAME_MAX, { error: t('settings.validation.maxLength', { max: String(NAME_MAX) }) }),
})

function NameCard() {
  const { user_id, display_name } = useReadyAccess()
  const rename = useUpdateDisplayName()
  // `values`: re-syncs once the access payload brings the saved name back.
  const form = useForm<z.input<typeof nameSchema>, unknown, z.output<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    values: { displayName: display_name },
  })
  const { errors, isDirty } = form.formState
  useUnsavedChanges(isDirty)

  const onSubmit = form.handleSubmit(({ displayName }) =>
    rename.mutate({ userId: user_id, displayName }, { onSuccess: () => form.reset({ displayName }) }),
  )

  return (
    <SettingsCard
      title={t('account.name.title')}
      description={t('account.name.description')}
      pending={rename.isPending}
      onSubmit={onSubmit}
      footer={<SaveButton pending={rename.isPending} disabled={!isDirty} />}
    >
      <FormField label={t('account.name.label')} required error={errors.displayName?.message}>
        {(field) => <Input {...field} autoComplete="name" {...form.register('displayName')} />}
      </FormField>
    </SettingsCard>
  )
}

// ── Courriel ────────────────────────────────────────────────────────────────────────────────────

const emailSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { error: t('auth.errors.required') })
    .pipe(z.email({ error: t('auth.errors.invalidEmail') })),
})

/** Errors GoTrue reports about the address itself: shown on the field. */
const EMAIL_FIELD_ERRORS: AuthErrorCode[] = ['email_exists', 'invalid_email']

function EmailCard() {
  const { updateEmail } = useAuth()
  const user = useAccountUser()
  const queryClient = useQueryClient()
  const current = user?.email ?? ''
  const [requested, setRequested] = useState<string | null>(null)
  const [error, setError] = useState<AuthErrorCode | null>(null)
  const form = useForm<z.input<typeof emailSchema>, unknown, z.output<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  })
  const { errors, isDirty, isSubmitting } = form.formState
  useUnsavedChanges(isDirty)

  // GoTrue keeps the address waiting for confirmation on the user, so the notice survives a reload.
  const pendingEmail = user?.new_email ?? requested
  const showPending = Boolean(pendingEmail) && pendingEmail?.toLowerCase() !== current.toLowerCase()

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null)
    if (email.toLowerCase() === current.toLowerCase()) {
      form.setError('email', { message: t('account.email.same') }, { shouldFocus: true })
      return
    }
    const code = await updateEmail(email)
    if (code && EMAIL_FIELD_ERRORS.includes(code)) {
      form.setError('email', { message: t(`auth.errors.${code}`) }, { shouldFocus: true })
      return
    }
    if (code) {
      setError(code)
      return
    }
    setRequested(email)
    form.reset()
    void queryClient.invalidateQueries({ queryKey: accountKeys.all })
  })

  return (
    <SettingsCard
      title={t('account.email.title')}
      description={t('account.email.description')}
      pending={isSubmitting}
      onSubmit={onSubmit}
      footer={
        <Button type="submit" disabled={!isDirty || isSubmitting}>
          {isSubmitting ? t('account.email.submitting') : t('account.email.submit')}
        </Button>
      }
    >
      <dl className="space-y-1">
        <dt className="text-sm font-medium text-foreground">{t('account.email.current')}</dt>
        <dd className="break-all text-sm text-foreground">{current}</dd>
      </dl>
      {showPending && (
        <Alert role="status">
          <MailCheck aria-hidden />
          <AlertTitle className="break-all">{t('account.email.pendingTitle', { email: pendingEmail ?? '' })}</AlertTitle>
          <AlertDescription>{t('account.email.pending')}</AlertDescription>
        </Alert>
      )}
      <FormField label={t('account.email.new')} required error={errors.email?.message}>
        {(field) => <Input {...field} type="email" autoComplete="email" {...form.register('email')} />}
      </FormField>
      {error && <ErrorAlert code={error} />}
    </SettingsCard>
  )
}

// ── Mot de passe ────────────────────────────────────────────────────────────────────────────────

// The new-password rules of « Choisir un nouveau mot de passe », plus the emailed code when asked.
const passwordSchema = z
  .object({ password: newPasswordRule, confirm: z.string(), code: z.string().trim() })
  .refine(passwordsMatch, passwordMismatch)

/** Errors about the chosen password: shown on the password field. */
const PASSWORD_FIELD_ERRORS: AuthErrorCode[] = ['weak_password', 'same_password']

function PasswordCard() {
  const { updatePassword, sendReauthenticationCode } = useAuth()
  const user = useAccountUser()
  // GoTrue asked for a code (session older than 24 h): it has been emailed.
  const [codeSent, setCodeSent] = useState(false)
  const [error, setError] = useState<AuthErrorCode | null>(null)
  const form = useForm<z.input<typeof passwordSchema>, unknown, z.output<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '', confirm: '', code: '' },
  })
  const { errors, isDirty, isSubmitting } = form.formState
  useUnsavedChanges(isDirty)

  const { setFocus } = form
  useEffect(() => {
    if (codeSent) setFocus('code')
  }, [codeSent, setFocus])

  const sendCode = async (): Promise<boolean> => {
    const code = await sendReauthenticationCode()
    setError(code)
    return !code
  }

  const onSubmit = form.handleSubmit(async ({ password, code }) => {
    setError(null)
    if (codeSent && !code) {
      form.setError('code', { message: t('account.password.codeRequired') }, { shouldFocus: true })
      return
    }
    const result = await updatePassword(password, codeSent ? code : undefined)
    if (result === 'reauthentication_needed') {
      if (await sendCode()) setCodeSent(true)
      return
    }
    if (result === 'invalid_code') {
      form.setError('code', { message: t('auth.errors.invalid_code') }, { shouldFocus: true })
      return
    }
    if (result && PASSWORD_FIELD_ERRORS.includes(result)) {
      form.setError('password', { message: t(`auth.errors.${result}`) }, { shouldFocus: true })
      return
    }
    if (result) {
      setError(result)
      return
    }
    toast.success(t('account.password.success'))
    setCodeSent(false)
    form.reset()
  })

  const resend = async () => {
    if (await sendCode()) toast.success(t('account.password.resent'))
  }

  return (
    <SettingsCard
      title={t('account.password.title')}
      description={t('account.password.description')}
      pending={isSubmitting}
      onSubmit={onSubmit}
      footer={
        <Button type="submit" disabled={!isDirty || isSubmitting}>
          {isSubmitting ? t('common.saving') : t('account.password.submit')}
        </Button>
      }
    >
      {/* Tells password managers which account the new password belongs to. */}
      <input type="text" name="username" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label={t('account.password.new')} required error={errors.password?.message}>
          {(field) => <Input {...field} type="password" autoComplete="new-password" {...form.register('password')} />}
        </FormField>
        <FormField label={t('account.password.confirm')} required error={errors.confirm?.message}>
          {(field) => <Input {...field} type="password" autoComplete="new-password" {...form.register('confirm')} />}
        </FormField>
      </div>
      {codeSent && (
        <div className="space-y-1">
          <FormField label={t('account.password.code')} required help={t('account.password.codeHelp')} error={errors.code?.message}>
            {(field) => (
              <Input
                {...field}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="sm:max-w-[12rem]"
                {...form.register('code')}
              />
            )}
          </FormField>
          <Button type="button" variant="link" size="sm" onClick={() => void resend()} disabled={isSubmitting}>
            {t('account.password.resend')}
          </Button>
        </div>
      )}
      {error && <ErrorAlert code={error} />}
    </SettingsCard>
  )
}

// ── Sessions ────────────────────────────────────────────────────────────────────────────────────

function SessionsCard() {
  const { signOutEverywhere } = useAuth()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthErrorCode | null>(null)

  const confirm = async () => {
    setPending(true)
    setError(null)
    const code = await signOutEverywhere()
    // On success the session is gone: RequireAuth leaves this page for plain /connexion (#17).
    if (code) {
      setError(code)
      setPending(false)
      setOpen(false)
    }
  }

  return (
    <SettingsCard
      title={t('account.sessions.title')}
      description={t('account.sessions.description')}
      footer={
        <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline">
              {t('account.sessions.signOutEverywhere')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('account.sessions.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('account.sessions.confirmBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {/* Radix focuses Cancel first: staying signed in is the safe default. */}
              <AlertDialogCancel disabled={pending}>{t('common.cancel')}</AlertDialogCancel>
              <Button type="button" variant="destructive" disabled={pending} onClick={() => void confirm()}>
                {pending ? t('account.sessions.pending') : t('account.sessions.confirm')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      }
    >
      {error && <ErrorAlert title={t('account.sessions.failed')} code={error} />}
    </SettingsCard>
  )
}

/** « Mon compte »: every role reaches it (outside Paramètres), from the user menu and the palette. */
export function AccountPage() {
  usePageTitle(t('pageTitles.account'))
  return (
    <div className="w-full max-w-form space-y-4">
      <PageHeader level={1} title={t('account.title')} description={t('account.description')} />
      <NameCard />
      <EmailCard />
      <PasswordCard />
      <SessionsCard />
    </div>
  )
}

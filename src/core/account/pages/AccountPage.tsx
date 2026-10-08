import { useEffect, useRef, useState } from 'react'
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
import { FormActions } from '@/shared/components/FormActions'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { useConfirmLeave, useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
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
import { cn } from '@/shared/lib/utils'

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
  // Follows the saved name (it re-syncs once the access payload brings it back) without wiping an
  // edit, e.g. on a refetch at window focus; after a save, keeps what was typed while saving.
  const { form, cancel, handleSave } = useSettingsForm({ schema: nameSchema, values: { displayName: display_name } })
  const { errors, isDirty } = form.formState
  useUnsavedChanges(isDirty)

  const onSubmit = handleSave(({ displayName }, onSaved) =>
    rename.mutate({ userId: user_id, displayName }, { onSuccess: () => onSaved({ displayName }) }),
  )

  return (
    <SettingsCard
      title={t('account.name.title')}
      description={t('account.name.description')}
      pending={rename.isPending}
      onSubmit={onSubmit}
      // « Annuler »: back to the last saved name.
      footer={<FormActions onCancel={cancel} onReset={() => form.setFocus('displayName')} dirty={isDirty} pending={rename.isPending} />}
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

function EmailCard() {
  const { updateEmail } = useAuth()
  const user = useAccountUser()
  const queryClient = useQueryClient()
  const current = user?.email ?? ''
  // The last request from this page succeeded. Its notice is neutral: an address used by another
  // account answers like a success (decision #38), so the page never names a change the server may
  // not have recorded. Cleared on each new attempt, so a later failure doesn't sit next to it.
  const [requested, setRequested] = useState(false)
  // A request from this page succeeded at least once. Never cleared: from then on, « en attente
  // vers … » stays hidden, even while a later attempt is in flight or after it fails, otherwise
  // new_email (recorded only for a real change) would show through.
  const [askedHere, setAskedHere] = useState(false)
  const [error, setError] = useState<AuthErrorCode | null>(null)
  const form = useForm<z.input<typeof emailSchema>, unknown, z.output<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  })
  const { errors, isDirty, isSubmitting } = form.formState
  useUnsavedChanges(isDirty)

  // Without a request from this page: the change GoTrue has recorded (new_email), after a reload.
  // After one, the neutral notice wins, even once new_email comes back: otherwise a real change and
  // an address already taken would end up looking different.
  const pendingEmail = user?.new_email
  const showPending = !askedHere && Boolean(pendingEmail) && pendingEmail?.toLowerCase() !== current.toLowerCase()

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setRequested(false)
    setError(null)
    if (email.toLowerCase() === current.toLowerCase()) {
      form.setError('email', { message: t('account.email.same') }, { shouldFocus: true })
      return
    }
    // Neutral (decision #38): an address used by another account comes back as null, like a success.
    const code = await updateEmail(email)
    if (code === 'invalid_email') {
      form.setError('email', { message: t('auth.errors.invalid_email') }, { shouldFocus: true })
      return
    }
    if (code) {
      setError(code)
      return
    }
    setRequested(true)
    setAskedHere(true)
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
        <FormActions
          onCancel={() => {
            setError(null)
            form.reset()
          }}
          onReset={() => form.setFocus('email')}
          dirty={isDirty}
          pending={isSubmitting}
          submitLabel={t('account.email.submit')}
          pendingLabel={t('account.email.submitting')}
        />
      }
    >
      <dl className="space-y-1">
        <dt className="text-sm font-medium text-foreground">{t('account.email.current')}</dt>
        <dd className="break-all text-sm text-foreground">{current}</dd>
      </dl>
      {/* Always rendered, so screen readers announce the notice when it appears inside. Empty, it
          takes no room (empty:!mt-0 cancels the card's spacing). */}
      <div role="status" className="empty:!mt-0">
        {requested && (
          <Alert>
            <MailCheck aria-hidden />
            <AlertTitle>{t('account.email.requestedTitle')}</AlertTitle>
            <AlertDescription>{t('account.email.requested')}</AlertDescription>
          </Alert>
        )}
        {showPending && (
          <Alert>
            <MailCheck aria-hidden />
            <AlertTitle className="break-all">{t('account.email.pendingTitle', { email: pendingEmail ?? '' })}</AlertTitle>
            <AlertDescription>{t('account.email.pending')}</AlertDescription>
          </Alert>
        )}
      </div>
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
  // Sending was throttled: a code sent moments ago is still in the mailbox and still valid.
  const [codeThrottled, setCodeThrottled] = useState(false)
  const [resending, setResending] = useState(false)
  const resendingRef = useRef(false)
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

  /** Emails a code. `throttled`: GoTrue refused to send another so soon; the last one still works. */
  const sendCode = async (): Promise<'sent' | 'throttled' | 'failed'> => {
    const code = await sendReauthenticationCode()
    setCodeThrottled(code === 'rate_limited')
    if (code === 'rate_limited') return 'throttled'
    setError(code)
    return code ? 'failed' : 'sent'
  }

  const onSubmit = form.handleSubmit(async ({ password, code }) => {
    setError(null)
    if (codeSent && !code) {
      form.setError('code', { message: t('account.password.codeRequired') }, { shouldFocus: true })
      return
    }
    const result = await updatePassword(password, codeSent ? code : undefined)
    if (result === 'reauthentication_needed') {
      if ((await sendCode()) !== 'failed') setCodeSent(true)
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
    leaveCodeStep()
  })

  const resend = async () => {
    // A ref, not the state: a double click lands before the next render.
    if (resendingRef.current) return
    resendingRef.current = true
    setResending(true)
    setError(null)
    try {
      const outcome = await sendCode()
      if (outcome === 'sent') toast.success(t('account.password.resent'))
      // The hint under the field changes silently; the toast is announced.
      else if (outcome === 'throttled') toast.info(t('account.password.codeRecent'))
    } finally {
      resendingRef.current = false
      setResending(false)
    }
  }

  const leaveCodeStep = () => {
    setError(null)
    setCodeSent(false)
    setCodeThrottled(false)
    form.reset()
  }

  return (
    <SettingsCard
      title={t('account.password.title')}
      description={t('account.password.description')}
      pending={isSubmitting}
      onSubmit={onSubmit}
      footer={
        <FormActions
          onCancel={leaveCodeStep}
          onReset={() => form.setFocus('password')}
          dirty={isDirty}
          pending={isSubmitting}
          submitLabel={t('account.password.submit')}
          pendingLabel={t('account.password.submitting')}
        />
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
          <FormField
            label={t('account.password.code')}
            required
            help={codeThrottled ? t('account.password.codeRecent') : t('account.password.codeHelp')}
            error={errors.code?.message}
          >
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
          <Button
            type="button"
            variant="link"
            size="sm"
            aria-disabled={isSubmitting || resending || undefined}
            onClick={ignoreWhenInactive(isSubmitting || resending, () => void resend())}
            className={softDisabledClasses}
          >
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
  const confirmLeave = useConfirmLeave()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthErrorCode | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Set by « Se déconnecter partout »: the sign-out starts once this dialog has closed.
  const signOutOnClose = useRef(false)

  const signOutNow = async () => {
    setPending(true)
    setError(null)
    const code = await signOutEverywhere()
    // On success the session is gone: RequireAuth leaves this page for plain /connexion (#17),
    // which then loads afresh.
    if (code) {
      setError(code)
      setPending(false)
    }
  }

  // Like the shell's « Se déconnecter », unsaved edits in another card are confirmed first
  // (confirmLeave). This runs from onCloseAutoFocus, i.e. once this dialog has finished closing,
  // rather than from an effect on `open`: Radix keeps the dialog mounted during its exit
  // animation, so an effect would open the unsaved-changes dialog over it, and that dialog would
  // record the departing « Se déconnecter partout » button as the place to return focus to.
  // Here focus is first put back on the trigger, which « Rester » then returns to.
  const onCloseAutoFocus = (event: Event) => {
    if (!signOutOnClose.current) return
    signOutOnClose.current = false
    event.preventDefault()
    triggerRef.current?.focus()
    confirmLeave(() => void signOutNow())
  }

  return (
    <SettingsCard
      as="section"
      title={t('account.sessions.title')}
      description={t('account.sessions.description')}
      footer={
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button
              ref={triggerRef}
              type="button"
              variant="outline"
              aria-disabled={pending || undefined}
              // While signing out: presses are ignored (and the dialog does not open), focus stays.
              onClick={ignoreWhenInactive(pending)}
              className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
            >
              {pending ? t('account.sessions.pending') : t('account.sessions.signOutEverywhere')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('account.sessions.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('account.sessions.confirmBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {/* Radix focuses Cancel first: staying signed in is the safe default. */}
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  signOutOnClose.current = true
                  setOpen(false)
                }}
              >
                {t('account.sessions.confirm')}
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

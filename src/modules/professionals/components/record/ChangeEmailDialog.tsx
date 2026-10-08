import { useRef, useState, type RefObject } from 'react'
import { useForm } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { rpcErrorHint } from '@/core/modules/errors'
import { SaveButton } from '@/shared/components/SaveButton'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { FieldsReadOnlyContext } from '@/shared/ui/read-only-context'
import { professionalKeys } from '../../hooks/keys'
import { useSetProfessionalEmail } from '../../hooks/use-professional-mutations'
import { loginEmailSchema, type LoginEmailValues } from '../../schemas/contact'

const E = 'modules.professionals.record.identity'

interface ChangeEmailDialogProps {
  professionalId: string
  email: string
  /**
   * The trigger shows: no account yet, and the user may edit. When it turns false while the
   * dialog is open (a refusal refetched the record or the access), the dialog stays, with its
   * message, until closed; only the trigger goes.
   */
  canChange: boolean
  /**
   * An invitation link is live: a new address revokes it and puts an invited file back to « À
   * inviter » (P4-300), which the dialog says before the change.
   */
  invitationLive: boolean
  /** Where focus returns on close once the trigger is gone (the login email field). */
  fallbackFocus: RefObject<HTMLInputElement | null>
}

/**
 * « Modifier » the login email, while the professional has no account (afterwards « Mon compte »
 * owns it). `set_professional_email` refuses an invalid or used address with HINT `email`: shown
 * under the field. Any other refusal (an account was created meanwhile, the permission withdrawn)
 * shows above the buttons and refetches the record, which then hides the trigger.
 */
export function ChangeEmailDialog({ professionalId, email, canChange, invitationLive, fallbackFocus }: ChangeEmailDialogProps) {
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const queryClient = useQueryClient()
  const form = useForm<LoginEmailValues, unknown, { email: string }>({ resolver: zodResolver(loginEmailSchema), values: { email } })
  const mutation = useSetProfessionalEmail({
    onErrorMessage: (message, error) => {
      if (rpcErrorHint(error) === 'email') {
        form.setError('email', { message }, { shouldFocus: true })
      } else {
        form.setError('root.server', { message })
        void queryClient.invalidateQueries({ queryKey: professionalKeys.record(professionalId) })
      }
    },
  })
  const pending = mutation.isPending
  const { errors, isDirty } = form.formState
  const { ref: registerRef, ...emailField } = form.register('email')

  const changeOpen = (next: boolean) => {
    if (pending) return
    if (!next) form.reset({ email })
    setOpen(next)
  }
  const submit = form.handleSubmit((values) =>
    mutation.mutate({ id: professionalId, email: values.email }, { onSuccess: () => setOpen(false) }),
  )

  // Rendered even without the trigger (nothing shows while closed): an open dialog never unmounts
  // under the user because a refetch took the trigger away.
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      {canChange && (
        <DialogTrigger asChild>
          <Button ref={trigger} type="button" variant="outline" aria-label={t(`${E}.contact.changeLabel`)}>
            {t(`${E}.contact.change`)}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          input.current?.select()
        }}
        onCloseAutoFocus={(event) => {
          // The trigger went while the dialog was open: focus the field it belonged to, not <body>.
          if (trigger.current) return
          event.preventDefault()
          fallbackFocus.current?.focus()
        }}
      >
        {/* Its own form: a card turning read-only behind it (access refetched) does not reach it. */}
        <FieldsReadOnlyContext.Provider value={false}>
          <DialogHeader>
            <DialogTitle>{t(`${E}.changeEmail.title`)}</DialogTitle>
            <DialogDescription>
              {t(`${E}.changeEmail.description`)}
              {invitationLive && ` ${t(`${E}.changeEmail.invitationStops`)}`}
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="grid gap-3.5"
            aria-busy={pending || undefined}
            onSubmit={(event) => {
              // The dialog is portalled out of the Coordonnées card's form, but React events still
              // bubble through the component tree: the card must never see this submit.
              event.stopPropagation()
              void submit(event)
            }}
          >
            <FormField label={t(`${E}.changeEmail.email`)} required error={errors.email?.message}>
              {(field) => (
                <Input
                  {...field}
                  {...emailField}
                  ref={(element) => {
                    registerRef(element)
                    input.current = element
                  }}
                  type="email"
                  autoComplete="off"
                />
              )}
            </FormField>
            {errors.root?.server?.message && (
              <Alert variant="destructive" role="alert">
                <CircleAlert aria-hidden />
                <AlertDescription className="text-foreground">{errors.root.server.message}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="outline"
                  aria-disabled={pending || undefined}
                  onClick={ignoreWhenInactive(pending)}
                  className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
                >
                  {t('common.cancel')}
                </Button>
              </DialogClose>
              <SaveButton pending={pending} disabled={!isDirty} variant={isDirty || pending ? 'default' : 'outline'} />
            </DialogFooter>
          </form>
        </FieldsReadOnlyContext.Provider>
      </DialogContent>
    </Dialog>
  )
}

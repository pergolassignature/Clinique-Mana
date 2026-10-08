import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { SaveButton } from '@/shared/components/SaveButton'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { FieldsReadOnlyContext } from '@/shared/ui/read-only-context'
import { Select } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { ficheSendFailure, useSendFiche } from '../../hooks/use-fiche'
import { fullName } from '../../lib/display'
import type { FicheTitle } from '../../lib/fiche'
import { FICHE_MESSAGE_MAX, sendFicheSchema, type SendFicheInput, type SendFicheValues } from '../../schemas/fiche'
import { useRecordData } from './record-context'

const S = 'modules.professionals.fiche.send'

interface SendFicheDialogProps {
  /** The professional's titles, primary first; a choice shows with two. */
  titles: readonly FicheTitle[]
  onClose: () => void
  /** Where focus goes once closed (the « Fiche PDF » button). */
  onCloseAutoFocus: (event: Event) => void
}

/**
 * « Envoyer par courriel » (Task 4c.5, P4-58): the client's address (required), the title when
 * there are two, an optional message. Sending makes the fiche in the browser, uploads that very
 * file and asks `professionals-fiche` to email it (`useSendFiche`). Mounted while open. A refused
 * address shows under its field; any other failure above the buttons, the dialog kept open with
 * what was typed. While sending, the fields are inert and the dialog stays.
 */
export function SendFicheDialog({ titles, onClose, onCloseAutoFocus }: SendFicheDialogProps) {
  const { record, catalog } = useRecordData()
  const send = useSendFiche()
  const pending = send.isPending
  const toField = useRef<HTMLInputElement | null>(null)
  const form = useForm<SendFicheValues, unknown, SendFicheInput>({
    resolver: zodResolver(sendFicheSchema),
    defaultValues: { to: '', message: '', titleId: titles[0]?.titleId ?? null },
  })
  const { errors } = form.formState
  const { ref: registerTo, ...toProps } = form.register('to')
  const messageLength = form.watch('message').length

  const submit = form.handleSubmit((values) =>
    send.mutate(
      { record, catalog, titleId: values.titleId, to: values.to, message: values.message },
      {
        onSuccess: onClose,
        onError: (error) => {
          const failure = ficheSendFailure(error)
          if (failure.field) form.setError(failure.field, { message: failure.message }, { shouldFocus: true })
          else form.setError('root.server', { message: failure.message })
        },
      },
    ),
  )

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          toField.current?.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <FieldsReadOnlyContext.Provider value={false}>
          <DialogHeader>
            <DialogTitle>{t(`${S}.title`)}</DialogTitle>
            <DialogDescription>{t(`${S}.description`, { name: fullName(record.professional) })}</DialogDescription>
          </DialogHeader>
          <form noValidate className="grid gap-3.5" aria-busy={pending || undefined} onSubmit={(event) => void submit(event)}>
            <fieldset disabled={pending} className="contents">
              <FormField label={t(`${S}.to`)} required error={errors.to?.message}>
                {(control) => (
                  <Input
                    {...control}
                    {...toProps}
                    ref={(element) => {
                      registerTo(element)
                      toField.current = element
                    }}
                    type="email"
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </FormField>
              {titles.length > 1 && (
                <FormField label={t(`${S}.titleLabel`)} help={t(`${S}.titleHelp`)}>
                  {(control) => (
                    <Select {...control} {...form.register('titleId')}>
                      {titles.map((title) => (
                        <option key={title.titleId} value={title.titleId}>
                          {title.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
              )}
              <FormField
                label={t(`${S}.message`)}
                help={t(`${S}.messageHelp`, { count: String(messageLength), max: String(FICHE_MESSAGE_MAX) })}
                error={errors.message?.message}
              >
                {(control) => <Textarea {...control} {...form.register('message')} rows={4} maxLength={FICHE_MESSAGE_MAX} />}
              </FormField>
            </fieldset>
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
              <SaveButton pending={pending} label={t(`${S}.submit`)} pendingLabel={t(`${S}.pending`)} />
            </DialogFooter>
          </form>
        </FieldsReadOnlyContext.Provider>
      </DialogContent>
    </Dialog>
  )
}

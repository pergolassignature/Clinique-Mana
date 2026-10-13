import { useEffect, useRef } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronLeft, CircleAlert, Paperclip } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SaveButton } from '@/shared/components/SaveButton'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { StatusDot } from '@/shared/ui/status-dot'
import { Textarea } from '@/shared/ui/textarea'
import type { SmsConsentStatus, SmsMessage } from '../../api/sms'
import { useSendSms, useSmsThread } from '../../hooks/use-sms'
import { formatPhone } from '../../lib/phone'
import { smsSendErrorMessage } from '../../lib/sms-errors'
import { smsConsentLabel, smsErrorText, smsKindLabel, smsStatusLabel } from '../../lib/sms-status'
import { composerSchema, SMS_BODY_MAX, type ComposerValues } from '../../schemas/sms'
import { setSmsThreadLink } from '../../api/sms'
import { ConsentDialog } from './ConsentDialog'
import { SmsThreadClientLink } from './SmsThreadClientLink'

const S = 'modules.communications.sms'

interface ThreadViewProps {
  phone: string
  /** The consent in force, from the thread list (null: none recorded). */
  consent: SmsConsentStatus | null
  /** On a phone, the list and the thread are stacked: « Retour aux conversations ». */
  onBack: () => void
  /** SM-16, from a file: the number is linked to it before its first text (null: already linked, or « Textos »). */
  linkClientId?: string | null
  /** SM-16: inside a file, the file is known: no link box. */
  hideLink?: boolean
}

/**
 * One conversation: its number and consent (with « Enregistrer » / « Retirer le consentement »),
 * the latest texts oldest first (received on the left, the clinic's on the right with their status
 * and, when failed, why), and the reply box, offered only while the consent is in force (the
 * database refuses a reply without it anyway).
 */
export function ThreadView({ phone, consent, onBack, linkClientId = null, hideLink = false }: ThreadViewProps) {
  const thread = useSmsThread(phone)
  const { can } = useAccess()
  const consentLabel = smsConsentLabel(consent)
  const heading = useRef<HTMLHeadingElement>(null)
  const end = useRef<HTMLLIElement>(null)
  const count = thread.data?.messages.length ?? 0

  // A new thread opened: focus its heading (the list stays where it was); new texts: scroll to the latest.
  useEffect(() => heading.current?.focus(), [phone])
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [phone, count])

  return (
    <section aria-label={t(`${S}.thread.label`, { phone: formatPhone(phone) })} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <Button type="button" variant="link" onClick={onBack} className="mb-1 lg:hidden">
            <ChevronLeft aria-hidden />
            {t(`${S}.thread.back`)}
          </Button>
          <h2 ref={heading} tabIndex={-1} className="tabular text-lg font-semibold text-foreground outline-none">
            {formatPhone(phone)}
          </h2>
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <StatusDot tone={consentLabel.tone} />
            {consentLabel.label}
          </p>
        </div>
        {can('communications.sms') && (
          <div className="flex shrink-0 items-center gap-1.5">
            {consent === 'opted_in' ? (
              <ConsentDialog status="opted_out" phone={phone} current={consent} trigger={<Button variant="outline">{t(`${S}.consent.withdraw`)}</Button>} />
            ) : (
              <ConsentDialog status="opted_in" phone={phone} current={consent} trigger={<Button variant="outline">{t(`${S}.consent.record`)}</Button>} />
            )}
          </div>
        )}
      </header>
      {!hideLink && can('clients.view') && (
        <div className="border-b border-border px-4 py-2">
          <SmsThreadClientLink phone={phone} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {thread.data ? (
          <>
            {thread.data.truncated && <p className="mb-3 text-center text-xs text-muted-foreground">{t(`${S}.thread.older`)}</p>}
            <ol className="space-y-3">
              {thread.data.messages.map((message) => (
                <MessageItem key={message.id} message={message} />
              ))}
              <li ref={end} aria-hidden className="h-0" />
            </ol>
          </>
        ) : thread.isError ? (
          <LoadError message={t(`${S}.thread.loadError`)} retrying={thread.isFetching} onRetry={() => void thread.refetch()} />
        ) : (
          <Loading />
        )}
      </div>
      <div className="border-t border-border px-4 py-3">
        {consent === 'opted_in' ? (
          <Composer key={phone} phone={phone} linkClientId={linkClientId} />
        ) : (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning-strong" />
            {t(consent === 'opted_out' ? `${S}.composer.withdrawn` : `${S}.composer.noConsent`)}
          </p>
        )}
      </div>
    </section>
  )
}

function MessageItem({ message }: { message: SmsMessage }) {
  const inbound = message.direction === 'in'
  const status = smsStatusLabel(message.status)
  return (
    <li className={cn('flex', inbound ? 'justify-start' : 'justify-end')}>
      <div className={cn('max-w-[min(32rem,85%)] space-y-1', !inbound && 'text-right')}>
        <div
          className={cn(
            'inline-block rounded-lg px-3 py-2 text-left text-sm whitespace-pre-wrap break-words',
            inbound ? 'bg-muted text-foreground' : 'bg-primary/10 text-foreground',
          )}
        >
          {message.purged ? (
            <span className="italic text-muted-foreground">{t(`${S}.thread.purged`)}</span>
          ) : (
            <>
              {message.body}
              {message.media.map((file, index) => (
                <span key={index} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Paperclip aria-hidden className="size-3 shrink-0" />
                  {file.name ? t(`${S}.thread.attachment`, { name: file.name }) : t(`${S}.thread.attachmentUnnamed`)}
                </span>
              ))}
            </>
          )}
        </div>
        <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground', !inbound && 'justify-end')}>
          <span className="tabular">{formatClinicDateTime(message.sentAt ?? message.createdAt)}</span>
          {!inbound && (
            <>
              <span>{smsKindLabel(message.kind)}</span>
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <StatusDot tone={status.tone} />
                {message.status === 'queued' && message.sendAfter
                  ? t(`${S}.thread.scheduled`, { date: formatClinicDateTime(message.sendAfter) })
                  : status.label}
              </span>
            </>
          )}
        </p>
        {message.status === 'failed' && <p className="text-xs text-destructive">{smsErrorText(message.errorCode)}</p>}
      </div>
    </li>
  )
}

/** The reply box: 1 to 1600 characters, sent at once through `sms-send`; a failure stays above the box. */
function Composer({ phone, linkClientId }: { phone: string; linkClientId: string | null }) {
  const form = useForm<ComposerValues, unknown, { body: string }>({ resolver: zodResolver(composerSchema), defaultValues: { body: '' } })
  const send = useSendSms()
  const { errors, isDirty } = form.formState
  useUnsavedChanges(isDirty)
  const body = useWatch({ control: form.control, name: 'body' })

  const submit = form.handleSubmit(async ({ body: text }) => {
    try {
      // SM-16: a first text written from a file links its number to that file first.
      if (linkClientId) await setSmsThreadLink(phone, linkClientId)
      await send.mutateAsync({ to: phone, body: text })
      form.reset({ body: '' })
    } catch (error) {
      form.setError('root.server', { message: smsSendErrorMessage(error, { failed: 'composer.failed', fallback: t(`${S}.composer.error`) }) })
    }
  })

  const alert = errors.root?.server?.message
  return (
    <form noValidate onSubmit={(event) => void submit(event)} aria-busy={send.isPending || undefined} className="space-y-2">
      {alert && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertDescription className="text-foreground">{alert}</AlertDescription>
        </Alert>
      )}
      <label htmlFor="sms-composer" className="sr-only">
        {t(`${S}.composer.label`)}
      </label>
      <Textarea
        id="sms-composer"
        {...form.register('body')}
        rows={3}
        className="min-h-20"
        placeholder={t(`${S}.composer.label`)}
        aria-invalid={errors.body ? true : undefined}
        aria-describedby="sms-composer-help"
        onKeyDown={(event) => {
          // ⌘/Ctrl + Entrée sends; Entrée alone is a new line.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            // Never a second send while the first is on its way.
            if (!send.isPending) void submit()
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id="sms-composer-help" className={cn('text-xs', errors.body ? 'text-destructive' : 'text-muted-foreground')}>
          {errors.body?.message ?? t(`${S}.composer.help`, { count: String(body.length) })}
        </p>
        <SaveButton pending={send.isPending} disabled={body.trim() === '' || body.length > SMS_BODY_MAX} label={t(`${S}.composer.send`)} pendingLabel={t(`${S}.composer.sending`)} />
      </div>
    </form>
  )
}

import { useMemo } from 'react'
import { t } from '@/i18n'
import type { EmailSender } from '@/core/email/api'
import { useSetEmailSender } from '@/core/email/hooks'
import { senderSchema, toSenderFormValues } from '@/core/email/schemas'
import { FormActions } from '@/shared/components/FormActions'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'

interface SenderCardProps {
  sender: EmailSender
  /** Without `settings.email_manage`. */
  readOnly: boolean
}

/**
 * « Expéditeur »: the name and address the clinic's emails come from, and where replies go. The
 * address is typed without its domain: the sending domain (« Clés et webhook ») is shown after it,
 * read-only. An empty reply-to falls back to the clinic's email (Identité légale).
 */
export function SenderCard({ sender, readOnly }: SenderCardProps) {
  const domain = sender.sending_domain
  const schema = useMemo(() => senderSchema(domain), [domain])
  const values = useMemo(() => toSenderFormValues(sender), [sender])
  const { form, cancel, handleSave } = useSettingsForm({ schema, values })
  const mutation = useSetEmailSender()
  const { isDirty } = form.formState
  const { errors } = form.formState
  useUnsavedChanges(isDirty && !readOnly)

  const onSubmit = handleSave((update, onSaved) =>
    mutation.mutate(update, {
      onSuccess: () => onSaved({ from_name: update.from_name, from_local: update.from_address.split('@')[0] ?? '', reply_to: update.reply_to ?? '' }),
    }),
  )

  return (
    <SettingsCard
      title={t('settings.email.sender.title')}
      description={t('settings.email.sender.description')}
      readOnly={readOnly}
      pending={mutation.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={<FormActions onCancel={cancel} onReset={() => form.setFocus('from_name')} dirty={isDirty} pending={mutation.isPending} />}
    >
      <FormField label={t('settings.email.sender.fromName')} required error={errors.from_name?.message}>
        {(field) => <Input {...field} {...form.register('from_name')} autoComplete="organization" />}
      </FormField>
      <FormField
        label={t('settings.email.sender.fromAddress')}
        required
        help={t('settings.email.sender.fromAddressHelp', { domain })}
        error={errors.from_local?.message}
      >
        {(field) => (
          <div className="flex min-w-0 items-center gap-1.5">
            <Input {...field} {...form.register('from_local')} autoComplete="off" spellCheck={false} className="min-w-0 flex-1" />
            {/* The domain is not typed: it comes from the sending domain. */}
            <span aria-hidden className="shrink-0 text-sm text-muted-foreground">
              @{domain}
            </span>
          </div>
        )}
      </FormField>
      <FormField label={t('settings.email.sender.replyTo')} help={t('settings.email.sender.replyToHelp')} error={errors.reply_to?.message}>
        {(field) => <Input {...field} {...form.register('reply_to')} type="email" autoComplete="email" spellCheck={false} />}
      </FormField>
    </SettingsCard>
  )
}

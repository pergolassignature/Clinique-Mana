import { useRef, useState, type FormEvent } from 'react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { webhookUrl } from '@/core/email/api'
import { useEmailSender, useLastWebhookEvent, useSendTestEmail, useSetEmailSendingDomain } from '@/core/email/hooks'
import { sendingDomainSchema } from '@/core/email/schemas'
import { SecretField } from '@/core/settings/components/SecretField'
import { WebhookAddressField } from '@/core/settings/components/WebhookAddressField'
import { useOrgSecretKeys } from '@/core/settings/secrets/hooks'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SaveButton } from '@/shared/components/SaveButton'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { FormField } from '@/shared/ui/form-field'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'

/** The Resend secrets, in `org_secrets` (P3-12: `settings.integrations_manage`). */
const SECRETS = [
  { key: 'resend_api_key', label: 'settings.email.keys.apiKey', help: 'settings.email.keys.apiKeyHelp' },
  { key: 'resend_webhook_secret', label: 'settings.email.keys.webhookSecret', help: 'settings.email.keys.webhookSecretHelp' },
] as const

/**
 * « Envoi et webhook »: the sending domain, the Resend API key and webhook secret (write-only), the
 * webhook address to give Resend, and when the last delivery event arrived. Changes need
 * `settings.integrations_manage`; everyone who sees the section sees the state. Its three reads
 * start with the sender card's (same render), so nothing waits on anything else.
 */
export function EmailKeysCard({ readOnly }: { readOnly: boolean }) {
  const { org_id: orgId } = useReadyAccess()
  const sender = useEmailSender()
  const secrets = useOrgSecretKeys()
  const lastEvent = useLastWebhookEvent()

  let secretFields
  if (secrets.isPending) {
    secretFields = <Loading />
  } else if (secrets.isError && !secrets.data) {
    secretFields = <LoadError message={t('settings.email.keys.secretsLoadError')} retrying={secrets.isFetching} onRetry={() => void secrets.refetch()} />
  } else {
    secretFields = SECRETS.map(({ key, label, help }) => (
      <SecretField
        key={key}
        secretKey={key}
        label={t(label)}
        help={t(help)}
        configuredAt={secrets.data.find((secret) => secret.key === key)?.updated_at ?? null}
        readOnly={readOnly}
      />
    ))
  }

  return (
    <SettingsCard as="section" title={t('settings.email.keys.title')} description={t(readOnly ? 'settings.email.keys.readOnlyDescription' : 'settings.email.keys.description')}>
      {sender.data ? <DomainForm domain={sender.data.sending_domain} readOnly={readOnly} /> : sender.isPending && <Loading />}
      {secretFields}
      <WebhookAddressField url={webhookUrl(orgId)} label={t('settings.email.keys.webhookUrl')} help={t('settings.email.keys.webhookUrlHelp')} />
      <ConnectionTest apiKeyConfigured={Boolean(secrets.data?.some((secret) => secret.key === 'resend_api_key'))} />
      <p role="status" className="text-sm text-muted-foreground">
        {lastEvent.isPending
          ? t('common.loading')
          : lastEvent.isError
            ? t('settings.email.keys.lastEventError')
            : lastEvent.data
              ? t('settings.email.keys.lastEvent', { date: formatClinicDateTime(lastEvent.data) })
              : t('settings.email.keys.noEvent')}
      </p>
    </SettingsCard>
  )
}

/**
 * « M'envoyer un courriel de test »: one email through the configured sender, to the caller's own
 * address (`email-test-send` never takes a recipient), built on the staff invitation's layout with
 * its own text and no button. The delivery event then shows on the line below once Resend posts it.
 * Needs `settings.email_manage` (the function's permission) and a saved API key.
 */
function ConnectionTest({ apiKeyConfigured }: { apiKeyConfigured: boolean }) {
  const { can } = useAccess()
  const { email } = useReadyAccess()
  const sendTest = useSendTestEmail()
  if (!can('settings.email_manage')) return null
  const T = 'settings.email.keys.test'
  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="outline"
        disabled={!apiKeyConfigured || sendTest.isPending}
        onClick={() =>
          sendTest.mutate({
            key: TEST_TEMPLATE_KEY,
            draft: { subject: t(`${T}.subject`), body: t(`${T}.body`), button_label: null },
          })
        }
      >
        {sendTest.isPending ? t(`${T}.sending`) : t(`${T}.button`, { email })}
      </Button>
      <p className="text-sm text-muted-foreground">{apiKeyConfigured ? t(`${T}.help`) : t(`${T}.needsKey`)}</p>
    </div>
  )
}

/** Any core template works: the test sends its own subject and text in that template's layout. */
const TEST_TEMPLATE_KEY = 'core.staff_invite'

/** « Domaine d'envoi », saved after a confirmation: the from address moves onto the new domain. */
function DomainForm({ domain, readOnly }: { domain: string; readOnly: boolean }) {
  // null: follow the stored domain.
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const mutation = useSetEmailSendingDomain()
  const inputRef = useRef<HTMLInputElement>(null)
  const value = draft ?? domain
  const dirty = draft !== null && draft !== domain
  useUnsavedChanges(dirty && !readOnly)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dirty || mutation.isPending) return
    const parsed = sendingDomainSchema.safeParse(value)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null)
      // As react-hook-form does elsewhere: the field takes focus and reads its error (aria-describedby).
      inputRef.current?.focus()
      return
    }
    if (parsed.data === domain) {
      setDraft(null)
      return
    }
    setConfirming(parsed.data)
  }

  return (
    <form onSubmit={submit} noValidate aria-busy={mutation.isPending || undefined} className="space-y-2">
      <FormField label={t('settings.email.keys.domain.label')} help={t('settings.email.keys.domain.help')} error={error ?? undefined} readOnly={readOnly}>
        {(field) => (
          <Input
            {...field}
            ref={inputRef}
            value={value}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value)
              setError(null)
            }}
          />
        )}
      </FormField>
      {!readOnly && (
        <div className="flex justify-end">
          <SaveButton pending={mutation.isPending} disabled={!dirty} variant={dirty || mutation.isPending ? 'default' : 'outline'} />
        </div>
      )}
      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.email.keys.domain.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.email.keys.domain.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming) mutation.mutate(confirming, { onSuccess: () => setDraft(null) })
              }}
            >
              {t('settings.email.keys.domain.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}

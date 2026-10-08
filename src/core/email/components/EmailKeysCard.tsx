import { useId, useState, type FormEvent } from 'react'
import { Copy } from 'lucide-react'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import { webhookUrl } from '@/core/email/api'
import { useEmailSender, useLastWebhookEvent, useSetEmailSendingDomain } from '@/core/email/hooks'
import { sendingDomainSchema } from '@/core/email/schemas'
import { SecretField } from '@/core/settings/components/SecretField'
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
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { toast } from '@/shared/ui/sonner'

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
      <WebhookAddress url={webhookUrl(orgId)} />
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

/** « Domaine d'envoi », saved after a confirmation: the from address moves onto the new domain. */
function DomainForm({ domain, readOnly }: { domain: string; readOnly: boolean }) {
  // null: follow the stored domain.
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const mutation = useSetEmailSendingDomain()
  const value = draft ?? domain
  const dirty = draft !== null && draft !== domain
  useUnsavedChanges(dirty && !readOnly)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dirty || mutation.isPending) return
    const parsed = sendingDomainSchema.safeParse(value)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null)
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

/** The webhook address, read-only, with « Copier ». */
function WebhookAddress({ url }: { url: string }) {
  const id = useId()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('settings.email.keys.webhookCopied'))
    } catch {
      toast.error(t('settings.email.keys.webhookCopyError'))
    }
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{t('settings.email.keys.webhookUrl')}</Label>
      <div className="flex min-w-0 items-center gap-2">
        <Input id={id} readOnly value={url} aria-describedby={`${id}-help`} spellCheck={false} className="min-w-0 flex-1" />
        <Button type="button" variant="outline" onClick={() => void copy()} className="max-sm:h-11">
          <Copy aria-hidden className="size-3.5" />
          {t('settings.email.keys.copy')}
        </Button>
      </div>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {t('settings.email.keys.webhookUrlHelp')}
      </p>
    </div>
  )
}

import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import { SecretField } from '@/core/settings/components/SecretField'
import { WebhookAddressField } from '@/core/settings/components/WebhookAddressField'
import { useOrgSecretKeys } from '@/core/settings/secrets/hooks'
import { webhookUrl, type SignatureRequestRow, type SigningSettings } from '@/core/signing/api'
import { signingErrorMessage } from '@/core/signing/errors'
import {
  syncOutcomeText,
  useLastDocumensoEvent,
  useLastSigningTest,
  useSendSigningTestDocument,
  useSetSigningSettings,
  useSigningSettings,
  useSyncSignatureRequest,
  useTestSigningConnection,
} from '@/core/signing/hooks'
import { baseUrlSchema, expirySchema, toBaseUrlFormValues, toExpiryFormValues } from '@/core/signing/schemas'
import { signatureStatusLabel } from '@/core/signing/status'
import { FormActions } from '@/shared/components/FormActions'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { StatusDot } from '@/shared/ui/status-dot'

/*
 * The « Réglages » tab of « Signature électronique » (design §6.4): three cards, each changed with
 * `settings.integrations_manage` only (`readOnly` without it; the page's one notice says so). The
 * address and the expiry are saved by one RPC (`set_signing_settings`), which takes a patch: each
 * card sends only its own field, so neither writes back a stale copy of the other's (P3-34).
 * Every read starts on the first render (each card calls its queries before any loading state),
 * so nothing waits on anything else.
 *
 * Live regions: only what a click here changes is announced (the connection test's and « Actualiser
 * l'état »'s outcomes), each in one region mounted with its card, empty until then. What the page
 * loads (the last event, the last test) is plain text: nothing is read out on arrival.
 */
interface CardProps {
  readOnly: boolean
}

/** Pins the outline variant's resting fill while a soft-disabled action runs. */
const PENDING_OUTLINE = cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card max-sm:h-11')

/** « Connexion »: the instance address, the API key (write-only) and « Tester la connexion ». */
export function SigningConnectionCard({ readOnly }: CardProps) {
  const settings = useSigningSettings()
  const secrets = useOrgSecretKeys()
  const apiKeyAt = secrets.data?.find((secret) => secret.key === 'documenso_api_key')?.updated_at ?? null
  // What the test reads; a new address or key makes the last outcome stale: the test remounts, empty.
  const tested = settings.data && secrets.data ? `${settings.data.base_url}|${apiKeyAt}` : null
  return (
    <SettingsCard as="section" title={t('settings.signing.connection.title')} description={t('settings.signing.connection.description')}>
      <SettingsLoad query={settings}>{(data) => <BaseUrlForm settings={data} readOnly={readOnly} hasApiKey={apiKeyAt !== null} />}</SettingsLoad>
      <DocumensoSecret
        secretKey="documenso_api_key"
        label={t('settings.signing.connection.apiKey')}
        help={t('settings.signing.connection.apiKeyHelp')}
        readOnly={readOnly}
      />
      {!readOnly && tested !== null && <ConnectionTest key={tested} />}
    </SettingsCard>
  )
}

/** « Webhook »: the address to give Documenso, its secret (write-only) and the last event received. */
export function SigningWebhookCard({ readOnly }: CardProps) {
  const { org_id: orgId } = useReadyAccess()
  const lastEvent = useLastDocumensoEvent()
  return (
    <SettingsCard as="section" title={t('settings.signing.webhook.title')} description={t('settings.signing.webhook.description')}>
      <WebhookAddressField url={webhookUrl(orgId)} label={t('settings.signing.webhook.url')} help={t('settings.signing.webhook.urlHelp')} />
      <DocumensoSecret
        secretKey="documenso_webhook_secret"
        label={t('settings.signing.webhook.secret')}
        help={t('settings.signing.webhook.secretHelp')}
        readOnly={readOnly}
      />
      {/* Not a live region: it is what the page loaded, not the outcome of anything done here. */}
      <p className="text-sm text-muted-foreground">
        {lastEvent.isPending
          ? t('common.loading')
          : lastEvent.isError
            ? t('settings.signing.webhook.lastEventError')
            : lastEvent.data
              ? t('settings.signing.webhook.lastEvent', { date: formatClinicDateTime(lastEvent.data) })
              : t('settings.signing.webhook.noEvent')}
      </p>
    </SettingsCard>
  )
}

/** « Envoi »: the expiry, « Envoyer un document test » and the caller's last test document. */
export function SigningSendCard({ readOnly }: CardProps) {
  const settings = useSigningSettings()
  // Test requests are readable with settings.integrations_manage only: not asked for without it.
  const lastTest = useLastSigningTest(!readOnly)
  return (
    <SettingsCard as="section" title={t('settings.signing.send.title')} description={t('settings.signing.send.description')}>
      <SettingsLoad query={settings}>{(data) => <ExpiryForm settings={data} readOnly={readOnly} />}</SettingsLoad>
      {!readOnly && <TestDocument lastTest={lastTest} />}
    </SettingsCard>
  )
}

/** The settings row, once loaded (each card shows its own loading or error). */
function SettingsLoad({ query, children }: { query: ReturnType<typeof useSigningSettings>; children: (settings: SigningSettings) => ReactNode }) {
  if (query.data) return children(query.data)
  if (query.isPending) return <Loading />
  return <LoadError message={t('settings.signing.loadError')} retrying={query.isFetching} onRetry={() => void query.refetch()} />
}

/** One org secret's state (« Configurée » / « Non configurée »), with « Remplacer » or « Ajouter ». */
function DocumensoSecret({ secretKey, label, help, readOnly }: { secretKey: string; label: string; help: string; readOnly: boolean }) {
  const secrets = useOrgSecretKeys()
  if (secrets.isPending) return <Loading />
  if (secrets.isError && !secrets.data) {
    return <LoadError message={t('settings.signing.secretsLoadError')} retrying={secrets.isFetching} onRetry={() => void secrets.refetch()} />
  }
  const configuredAt = secrets.data.find((secret) => secret.key === secretKey)?.updated_at ?? null
  return <SecretField secretKey={secretKey} label={label} help={help} configuredAt={configuredAt} readOnly={readOnly} />
}

/** Read-only: Enter in the field would still submit the form implicitly; nothing may be saved. */
const preventSubmit = (event: FormEvent<HTMLFormElement>) => event.preventDefault()

/**
 * « Adresse de l'instance », saved alone. A new address origin deletes the stored API key (P3-34):
 * while the address is being changed and a key is stored, the help says so.
 */
function BaseUrlForm({ settings, readOnly, hasApiKey }: { settings: SigningSettings; readOnly: boolean; hasApiKey: boolean }) {
  const values = useMemo(() => toBaseUrlFormValues(settings), [settings])
  const { form, cancel, handleSave } = useSettingsForm({ schema: baseUrlSchema, values })
  const mutation = useSetSigningSettings(t('settings.signing.connection.saved'))
  const { isDirty, errors } = form.formState
  useUnsavedChanges(isDirty && !readOnly)

  const onSubmit = handleSave(({ base_url }, onSaved) => mutation.mutate({ base_url }, { onSuccess: () => onSaved({ base_url: base_url ?? '' }) }))
  const help = t('settings.signing.connection.baseUrlHelp')

  return (
    <form onSubmit={readOnly ? preventSubmit : (event) => void onSubmit(event)} noValidate aria-busy={mutation.isPending || undefined} className="space-y-2">
      <FormField
        label={t('settings.signing.connection.baseUrl')}
        help={isDirty && hasApiKey && !readOnly ? `${help} ${t('settings.signing.connection.keyClearedWarning')}` : help}
        error={errors.base_url?.message}
        readOnly={readOnly}
      >
        {(field) => (
          <Input {...field} {...form.register('base_url')} type="url" inputMode="url" placeholder="https://" autoComplete="off" spellCheck={false} />
        )}
      </FormField>
      {!readOnly && (
        <div className="flex justify-end gap-2">
          <FormActions onCancel={cancel} onReset={() => form.setFocus('base_url')} dirty={isDirty} pending={mutation.isPending} />
        </div>
      )}
    </form>
  )
}

/** « Délai d'expiration (jours) », saved alone. */
function ExpiryForm({ settings, readOnly }: { settings: SigningSettings; readOnly: boolean }) {
  const values = useMemo(() => toExpiryFormValues(settings), [settings])
  const { form, cancel, handleSave } = useSettingsForm({ schema: expirySchema, values })
  const mutation = useSetSigningSettings(t('settings.signing.send.saved'))
  const { isDirty, errors } = form.formState
  useUnsavedChanges(isDirty && !readOnly)

  const onSubmit = handleSave(({ expiry_days }, onSaved) => mutation.mutate({ expiry_days }, { onSuccess: () => onSaved({ expiry_days: String(expiry_days) }) }))

  return (
    <form onSubmit={readOnly ? preventSubmit : (event) => void onSubmit(event)} noValidate aria-busy={mutation.isPending || undefined} className="space-y-2">
      <FormField label={t('settings.signing.send.expiry')} help={t('settings.signing.send.expiryHelp')} error={errors.expiry_days?.message} readOnly={readOnly}>
        {(field) => <Input {...field} {...form.register('expiry_days')} inputMode="numeric" autoComplete="off" className="w-24" />}
      </FormField>
      {!readOnly && (
        <div className="flex justify-end gap-2">
          <FormActions onCancel={cancel} onReset={() => form.setFocus('expiry_days')} dirty={isDirty} pending={mutation.isPending} />
        </div>
      )}
    </form>
  )
}

interface Outcome {
  ok: boolean
  text: string
  hint?: string
}

/**
 * « Tester la connexion »: the stored address and key, read once by `signing-test-connection`. The
 * outcome stays next to the button (a live region) until the next test.
 */
function ConnectionTest() {
  const test = useTestSigningConnection()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const run = () => {
    setOutcome(null)
    test.mutate(undefined, {
      onSuccess: (result) =>
        setOutcome(
          result.ok
            ? { ok: true, text: t('settings.signing.connection.success') }
            : {
                ok: false,
                text: t('settings.signing.connection.failed', { status: String(result.status) }),
                // Documenso refuses an unknown or revoked key with 401 (403: not allowed).
                ...((result.status === 401 || result.status === 403) && { hint: t('settings.signing.connection.keyRefused') }),
              },
        ),
      onError: (error) => setOutcome({ ok: false, text: signingErrorMessage(error) }),
    })
  }
  return (
    <div className="space-y-1.5 border-t border-border-light pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button type="button" variant="outline" aria-disabled={test.isPending || undefined} onClick={ignoreWhenInactive(test.isPending, run)} className={PENDING_OUTLINE}>
          {test.isPending ? t('settings.signing.connection.testing') : t('settings.signing.connection.test')}
        </Button>
        <OutcomeStatus outcome={outcome} />
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.signing.connection.testHelp')}</p>
    </div>
  )
}

/**
 * The one live region of an action: always mounted (a region added with its text is not reliably
 * read), empty until the action ends, emptied when it starts again so the same text is read again.
 */
function OutcomeStatus({ outcome }: { outcome: Outcome | null }) {
  const Icon = outcome?.ok ? CircleCheck : CircleAlert
  return (
    <div role="status" className="min-w-0 text-sm">
      {outcome && (
        <p className="inline-flex items-start gap-1.5 text-foreground">
          <Icon aria-hidden className={cn('mt-0.5 size-3.5 shrink-0', outcome.ok ? 'text-success' : 'text-destructive')} />
          <span>{outcome.text}</span>
        </p>
      )}
      {outcome?.hint && <p className="text-xs text-muted-foreground">{outcome.hint}</p>}
    </div>
  )
}

/**
 * « Envoyer un document test » to the caller, and the state of the last one (plain text: it is what
 * the page loaded). « Actualiser l'état »'s outcome goes in this block's one status region, beside
 * the button rather than in a toast, and only for the test it was asked for.
 */
function TestDocument({ lastTest }: { lastTest: ReturnType<typeof useLastSigningTest> }) {
  const { email } = useReadyAccess()
  const { send, isPending } = useSendSigningTestDocument()
  const sync = useSyncSignatureRequest()
  const [synced, setSynced] = useState<{ requestId: string; outcome: Outcome } | null>(null)
  const request = lastTest.data ?? null
  const refresh = (requestId: string) => {
    setSynced(null)
    sync.mutate(requestId, {
      onSuccess: ({ outcome }) => setSynced({ requestId, outcome: syncOutcomeText(outcome) }),
      onError: (error) => setSynced({ requestId, outcome: { ok: false, text: signingErrorMessage(error) } }),
    })
  }
  return (
    <div className="space-y-2 border-t border-border-light pt-3">
      <div className="space-y-1">
        <Button type="button" variant="outline" aria-disabled={isPending || undefined} onClick={ignoreWhenInactive(isPending, send)} className={PENDING_OUTLINE}>
          {isPending ? t('settings.signing.send.testSending') : t('settings.signing.send.testDocument')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('settings.signing.send.testHelp', { email })}</p>
      </div>
      {request ? (
        <LastTest request={request} refreshing={sync.isPending} onRefresh={() => refresh(request.id)} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {lastTest.isPending ? t('common.loading') : lastTest.isError ? t('settings.signing.send.lastTestError') : t('settings.signing.send.noTest')}
        </p>
      )}
      <OutcomeStatus outcome={synced && synced.requestId === request?.id ? synced.outcome : null} />
    </div>
  )
}

/** Statuses Documenso may still move: « Actualiser l'état » reads them back. */
const OPEN = new Set(['sent', 'viewed'])

/** The last test's state, with « Actualiser l'état » while open. */
function LastTest({ request, refreshing, onRefresh }: { request: SignatureRequestRow; refreshing: boolean; onRefresh: () => void }) {
  const { label, tone, detail } = signatureStatusLabel(request.status, request.last_error)
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-1.5">
        <span>{t('settings.signing.send.lastTest', { date: formatClinicDateTime(request.sent_at ?? request.created_at) })}</span>
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <StatusDot tone={tone} />
          {label}
        </span>
        {detail && <span className="basis-full text-xs">{detail}</span>}
      </p>
      {OPEN.has(request.status) && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={refreshing || undefined}
          onClick={ignoreWhenInactive(refreshing, onRefresh)}
          className={PENDING_OUTLINE}
        >
          {refreshing ? t('settings.signing.send.refreshing') : t('settings.signing.send.refresh')}
        </Button>
      )}
    </div>
  )
}

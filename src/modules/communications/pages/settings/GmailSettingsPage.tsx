import { useMemo, useRef, useState, type FormEvent } from 'react'
import { CircleAlert, CircleCheck, Plus, RefreshCw } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { rpcErrorHint } from '@/core/modules/errors'
import { ScheduledJobState } from '@/core/jobs/components/ScheduledJobState'
import { SecretField } from '@/core/settings/components/SecretField'
import { WebhookAddressField } from '@/core/settings/components/WebhookAddressField'
import { useOrgSecretKeys } from '@/core/settings/secrets/hooks'
import { FormActions } from '@/shared/components/FormActions'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { cn } from '@/shared/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog'
import { Badge } from '@/shared/ui/badge'
import { Button, buttonVariants } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { StatusDot } from '@/shared/ui/status-dot'
import { gmailPushAudience, gmailWebhookUrl, type CommunicationsSettings, type MailConnection } from '../../api/mailboxes'
import { communicationsErrorMessage } from '../../api/errors'
import {
  useCommunicationsSettings,
  useDisconnectMailConnection,
  useMailConnections,
  useSaveCommunicationsSettings,
  useStartGmailConnect,
  useSyncMailConnection,
} from '../../hooks/use-mailboxes'
import { mailboxStatus, syncOutcomeText } from '../../lib/mailbox-status'
import { pushSettingsSchema, toPushSettingsFormValues } from '../../schemas/topic'

const G = 'modules.communications.settings.gmail'

/** The app path Google sends the browser back to (`_shared/gmail/env.ts` RETURN_PATH). */
export const GOOGLE_RETURN_PATH = '/courriels/retour-google'

/** The jobs of the sync (CM1): off by default, like every business job. */
const SYNC_JOB = 'communications.gmail_sync'
const WATCH_JOB = 'communications.gmail_watch_renew'

/** The secrets of the clinic's Google application (`_shared/gmail/env.ts`). */
const CLIENT_ID = 'google_oauth_client_id'
const CLIENT_SECRET = 'google_oauth_client_secret'

/** Pins the outline variant's resting fill while a soft-disabled action runs. */
const PENDING_OUTLINE = cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card max-sm:h-11')

/**
 * Paramètres → Courriels Gmail (plan §11, CM1; seen and changed with
 * `communications.mailboxes_manage`): the sync's status screen and its setup, on one surface.
 * - « Boîtes connectées »: each mailbox's state in plain words, its last sync, « Synchroniser »,
 *   « Reconnecter » and « Déconnecter »; « Connecter une boîte » leaves for Google's consent page.
 * - « Application Google »: the OAuth client (write-only secrets, changed with
 *   `settings.integrations_manage` only) and the return address to give Google.
 * - « Notifications de Google »: the Pub/Sub topic and the push subscription's service account
 *   (one form), the subscription's address and audience to copy (CM-4: authenticated pushes).
 * - « Tâches planifiées »: whether the 15-minute sync and the watch renewal run.
 */
export function GmailSettingsPage() {
  const { can } = useAccess()
  const secretsReadOnly = !can('settings.integrations_manage')
  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${G}.title`)} description={t(`${G}.description`)} />
      <SectionSurface>
        <MailboxesCard />
        <GoogleAppCard readOnly={secretsReadOnly} />
        <PushCard />
        <JobsCard canRead={can('settings.view')} />
      </SectionSurface>
    </div>
  )
}

interface Outcome {
  ok: boolean
  text: string
}

/**
 * The one live region of an action: always mounted, empty until the action ends, emptied when it
 * starts again so the same text is read again.
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
    </div>
  )
}

/** « Boîtes connectées »: the mailboxes and « Connecter une boîte ». */
function MailboxesCard() {
  const mailboxes = useMailConnections()
  const connect = useStartGmailConnect()
  const { can } = useAccess()
  const secrets = useOrgSecretKeys()
  // Without settings.view the secrets' list is empty: no warning then (the function answers).
  const appMissing =
    can('settings.view') && secrets.data !== undefined && !(secrets.data.some((s) => s.key === CLIENT_ID) && secrets.data.some((s) => s.key === CLIENT_SECRET))

  let list
  if (mailboxes.data) {
    list =
      mailboxes.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${G}.mailboxes.empty`)}</p>
      ) : (
        <ul className="divide-y divide-border-light">
          {mailboxes.data.map((mailbox) => (
            <MailboxRow key={mailbox.id} mailbox={mailbox} />
          ))}
        </ul>
      )
  } else if (mailboxes.isError) {
    list = <LoadError message={t(`${G}.mailboxes.loadError`)} retrying={mailboxes.isFetching} onRetry={() => void mailboxes.refetch()} />
  } else {
    list = <Loading />
  }

  return (
    <SettingsCard as="section" layout="section" title={t(`${G}.mailboxes.title`)} description={t(`${G}.mailboxes.description`)}>
      {list}
      <div className="space-y-1 border-t border-border-light pt-3">
        <Button
          type="button"
          variant="outline"
          aria-disabled={connect.isPending || undefined}
          onClick={ignoreWhenInactive(connect.isPending, () => connect.mutate())}
          className={PENDING_OUTLINE}
        >
          <Plus aria-hidden className="size-3.5" />
          {connect.isPending ? t(`${G}.mailboxes.connecting`) : t(`${G}.mailboxes.connect`)}
        </Button>
        <p className="text-xs text-muted-foreground">{appMissing ? t(`${G}.mailboxes.appMissing`) : t(`${G}.mailboxes.connectHelp`)}</p>
      </div>
    </SettingsCard>
  )
}

/** One mailbox: its address, state, last sync and counts, and its actions. */
function MailboxRow({ mailbox }: { mailbox: MailConnection }) {
  const status = mailboxStatus(mailbox)
  const settings = useCommunicationsSettings()
  const unwatched =
    mailbox.status === 'connected' &&
    mailbox.initial_sync_done &&
    Boolean(settings.data?.pubsub_topic) &&
    (mailbox.watch_expires_at === null || Date.parse(mailbox.watch_expires_at) <= Date.now())
  const sync = useSyncMailConnection()
  const connect = useStartGmailConnect()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const active = mailbox.status === 'connected'
  const runSync = () => {
    setOutcome(null)
    sync.mutate(
      { connectionId: mailbox.id },
      {
        onSuccess: (result) => setOutcome(syncOutcomeText(result)),
        onError: (error) => setOutcome({ ok: false, text: communicationsErrorMessage(error) }),
      },
    )
  }
  return (
    <li className="space-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-all font-medium text-foreground">{mailbox.email_address}</span>
        {mailbox.kind === 'personal' && <Badge variant="outline">{t(`${G}.mailboxes.personal`)}</Badge>}
        <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
          <StatusDot tone={status.tone} />
          {status.label}
        </span>
      </div>
      {status.detail && <p className="text-xs text-muted-foreground">{status.detail}</p>}
      {unwatched && <p className="text-xs text-muted-foreground">{t(`${G}.mailboxes.unwatched`)}</p>}
      <p className="text-xs text-muted-foreground">
        {mailbox.last_sync_at ? t(`${G}.mailboxes.lastSync`, { date: formatClinicDateTime(mailbox.last_sync_at) }) : t(`${G}.mailboxes.neverSynced`)}
        {' · '}
        {t(mailbox.thread_count === 1 ? `${G}.mailboxes.threadsOne` : `${G}.mailboxes.threadsOther`, { count: String(mailbox.thread_count) })}
        {' · '}
        {t(mailbox.unread_count === 1 ? `${G}.mailboxes.unreadOne` : `${G}.mailboxes.unreadOther`, { count: String(mailbox.unread_count) })}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
        {active && (
          <Button type="button" variant="outline" size="sm" aria-disabled={sync.isPending || undefined} onClick={ignoreWhenInactive(sync.isPending, runSync)} className={PENDING_OUTLINE}>
            <RefreshCw aria-hidden className={cn('size-3.5', sync.isPending && 'motion-safe:animate-spin')} />
            {sync.isPending ? t(`${G}.mailboxes.syncing`) : t(`${G}.mailboxes.sync`)}
          </Button>
        )}
        {!active && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={connect.isPending || undefined}
            onClick={ignoreWhenInactive(connect.isPending, () => connect.mutate())}
            className={PENDING_OUTLINE}
          >
            {connect.isPending ? t(`${G}.mailboxes.connecting`) : t(`${G}.mailboxes.reconnect`)}
          </Button>
        )}
        {mailbox.status !== 'disconnected' && <DisconnectButton mailbox={mailbox} />}
        <OutcomeStatus outcome={outcome} />
      </div>
      {!active && <p className="text-xs text-muted-foreground">{t(`${G}.mailboxes.reconnectHelp`, { email: mailbox.email_address })}</p>}
    </li>
  )
}

/** « Déconnecter », confirmed: the tokens go, the synchronised mail stays. */
function DisconnectButton({ mailbox }: { mailbox: MailConnection }) {
  const disconnect = useDisconnectMailConnection()
  const confirmed = useRef(false)
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-disabled={disconnect.isPending || undefined} className={cn(softDisabledClasses, 'max-sm:h-11')}>
          {disconnect.isPending ? t(`${G}.mailboxes.disconnecting`) : t(`${G}.mailboxes.disconnect`)}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!confirmed.current) return
          // The row's actions change once disconnected: the page keeps the focus where it is.
          event.preventDefault()
          confirmed.current = false
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${G}.mailboxes.disconnectConfirm.title`, { email: mailbox.email_address })}</AlertDialogTitle>
          <AlertDialogDescription>{t(`${G}.mailboxes.disconnectConfirm.body`)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            onClick={() => {
              confirmed.current = true
              if (!disconnect.isPending) disconnect.mutate(mailbox.id)
            }}
          >
            {t(`${G}.mailboxes.disconnectConfirm.action`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** One org secret's state (« Configurée » / « Non configurée »), with « Remplacer » or « Ajouter ». */
function OrgSecret({ secretKey, label, help, readOnly }: { secretKey: string; label: string; help: string; readOnly: boolean }) {
  const { can } = useAccess()
  const secrets = useOrgSecretKeys()
  // `list_org_secret_keys` answers nothing without settings.view: never « Non configurée » then.
  if (!can('settings.view')) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{t(`${G}.secretsUnknown`)}</p>
      </div>
    )
  }
  if (secrets.isPending) return <Loading />
  if (secrets.isError && !secrets.data) {
    return <LoadError message={t(`${G}.secretsLoadError`)} retrying={secrets.isFetching} onRetry={() => void secrets.refetch()} />
  }
  const configuredAt = secrets.data.find((secret) => secret.key === secretKey)?.updated_at ?? null
  return <SecretField secretKey={secretKey} label={label} help={help} configuredAt={configuredAt} readOnly={readOnly} />
}

/** « Application Google »: the OAuth client and the return address to declare at Google. */
function GoogleAppCard({ readOnly }: { readOnly: boolean }) {
  return (
    <SettingsCard as="section" layout="section" title={t(`${G}.app.title`)} description={t(`${G}.app.description`)}>
      <OrgSecret secretKey={CLIENT_ID} label={t(`${G}.app.clientId`)} help={t(`${G}.app.clientIdHelp`)} readOnly={readOnly} />
      <OrgSecret secretKey={CLIENT_SECRET} label={t(`${G}.app.clientSecret`)} help={t(`${G}.app.clientSecretHelp`)} readOnly={readOnly} />
      <WebhookAddressField url={`${window.location.origin}${GOOGLE_RETURN_PATH}`} label={t(`${G}.app.redirect`)} help={t(`${G}.app.redirectHelp`)} />
      {readOnly && <p className="text-xs text-muted-foreground">{t(`${G}.app.readOnly`)}</p>}
    </SettingsCard>
  )
}

/** « Notifications de Google »: the topic and the service account, then what to give Pub/Sub. */
function PushCard() {
  const { org_id: orgId } = useReadyAccess()
  const settings = useCommunicationsSettings()
  let form
  if (settings.data) form = <PushSettingsForm settings={settings.data} />
  else if (settings.isError)
    form = <LoadError message={t(`${G}.topic.loadError`)} retrying={settings.isFetching} onRetry={() => void settings.refetch()} />
  else form = <Loading />
  return (
    <SettingsCard as="section" layout="section" title={t(`${G}.push.title`)} description={t(`${G}.push.description`)}>
      {form}
      <WebhookAddressField url={gmailWebhookUrl(orgId)} label={t(`${G}.push.url`)} help={t(`${G}.push.urlHelp`)} />
      <WebhookAddressField url={gmailPushAudience(orgId)} label={t(`${G}.push.audience`)} help={t(`${G}.push.audienceHelp`)} />
    </SettingsCard>
  )
}

/** Read-only: Enter in the field would still submit the form implicitly; nothing may be saved. */
const preventSubmit = (event: FormEvent<HTMLFormElement>) => event.preventDefault()

/** « Sujet Pub/Sub » and « Compte de service de l'abonnement », saved together (`set_communications_settings`). */
function PushSettingsForm({ settings }: { settings: CommunicationsSettings }) {
  const values = useMemo(() => toPushSettingsFormValues(settings), [settings])
  const { form, cancel, handleSave } = useSettingsForm({ schema: pushSettingsSchema, values })
  const save = useSaveCommunicationsSettings()
  const { isDirty, errors } = form.formState
  useUnsavedChanges(isDirty)

  const onSubmit = handleSave((patch, onSaved) =>
    save.mutate(patch, {
      onSuccess: (saved) => onSaved(toPushSettingsFormValues(saved)),
      onError: (error) => {
        // The database checks both again; its HINT names the field.
        const field = rpcErrorHint(error) === 'pubsub_service_account' ? 'pubsub_service_account' : 'pubsub_topic'
        form.setError(field, { message: communicationsErrorMessage(error, t(`${G}.topic.saveError`)) }, { shouldFocus: true })
      },
    }),
  )

  return (
    <form onSubmit={save.isPending ? preventSubmit : (event) => void onSubmit(event)} noValidate aria-busy={save.isPending || undefined} className="space-y-2">
      <FormField label={t(`${G}.topic.label`)} help={t(`${G}.topic.help`)} error={errors.pubsub_topic?.message}>
        {(field) => (
          <Input {...field} {...form.register('pubsub_topic')} placeholder="projects/…/topics/…" autoComplete="off" spellCheck={false} />
        )}
      </FormField>
      <FormField label={t(`${G}.push.account`)} help={t(`${G}.push.accountHelp`)} error={errors.pubsub_service_account?.message}>
        {(field) => (
          <Input
            {...field}
            {...form.register('pubsub_service_account')}
            type="email"
            inputMode="email"
            placeholder="nom@projet.iam.gserviceaccount.com"
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </FormField>
      <div className="flex justify-end gap-2 empty:hidden">
        <FormActions onCancel={cancel} onReset={() => form.setFocus('pubsub_topic')} dirty={isDirty} pending={save.isPending} />
      </div>
    </form>
  )
}

/** « Tâches planifiées »: the 15-minute sync and the watch renewal (off by default). */
function JobsCard({ canRead }: { canRead: boolean }) {
  return (
    <SettingsCard as="section" layout="section" title={t(`${G}.jobs.title`)} description={t(`${G}.jobs.description`)}>
      {canRead ? (
        <div className="space-y-3">
          <ScheduledJobState jobKey={SYNC_JOB} texts={`${G}.jobs.sync`} />
          <ScheduledJobState jobKey={WATCH_JOB} texts={`${G}.jobs.watch`} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t(`${G}.jobs.unknown`)}</p>
      )}
    </SettingsCard>
  )
}

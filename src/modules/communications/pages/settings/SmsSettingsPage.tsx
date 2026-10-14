import { useMemo, type FormEvent } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { useScheduledJobs, useSetScheduledJobEnabled } from '@/core/jobs/hooks'
import { SecretField } from '@/core/settings/components/SecretField'
import { WebhookAddressField } from '@/core/settings/components/WebhookAddressField'
import { SETTINGS_BASE_PATH } from '@/core/settings/paths'
import { useOrgSecretKeys } from '@/core/settings/secrets/hooks'
import { useSettingsSection } from '@/core/settings/section-context'
import { FormActions } from '@/shared/components/FormActions'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SaveButton } from '@/shared/components/SaveButton'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { smsWebhookUrl, type SmsSettings } from '../../api/sms-settings'
import { useLastYeastarEvent, useSaveSmsSettings, useSendSmsTest, useSmsSettings } from '../../hooks/use-sms-settings'
import { pbxSchema, testSchema, textsSchema, toPbxValues, toTextsValues, type TestValues } from '../../schemas/sms'

const S = 'modules.communications.sms.settings'
export const SMS_DISPATCH_JOB = 'communications.sms_dispatch'

/**
 * Paramètres → Textos (batch SM; seen and changed with `communications.sms_manage`): the PBX (its
 * address, the OpenAPI application's id and secret, the clinic's SMS number), the address and secret
 * of the PBX's « Webhook Event Push » entry with the last event received, the two automatic texts,
 * and « Envoi »: whether the dispatch job runs, and a test text. The secrets are write-only
 * (`SecretField`) and changed with `settings.integrations_manage`; the secrets' state and the last
 * event are read with `settings.view`.
 */
export function SmsSettingsPage() {
  const { readOnly } = useSettingsSection()
  const settings = useSmsSettings()

  let content
  if (settings.data) {
    content = (
      <SectionSurface>
        <PbxCard settings={settings.data} readOnly={readOnly} />
        <WebhookCard readOnly={readOnly} />
        <TextsCard settings={settings.data} readOnly={readOnly} />
        <SendCard readOnly={readOnly} />
      </SectionSurface>
    )
  } else if (settings.isError) {
    content = <LoadError message={t(`${S}.loadError`)} retrying={settings.isFetching} onRetry={() => void settings.refetch()} />
  } else {
    content = <Loading />
  }

  return (
    <div className="space-y-5">
      <PageHeader level={1} title={t(`${S}.title`)} description={t(`${S}.description`)} />
      {readOnly && <ReadOnlyNotice />}
      {content}
    </div>
  )
}

interface CardProps {
  readOnly: boolean
}

/** An org secret's state with « Remplacer », read-only without `settings.integrations_manage`. */
function SmsSecret({ secretKey, label, help, readOnly }: { secretKey: string; label: string; help: string; readOnly: boolean }) {
  const { can } = useAccess()
  const secrets = useOrgSecretKeys()
  if (!can('settings.view')) return null
  if (secrets.isPending) return <Loading />
  if (secrets.isError && !secrets.data) {
    return <LoadError message={t(`${S}.secretsLoadError`)} retrying={secrets.isFetching} onRetry={() => void secrets.refetch()} />
  }
  const configuredAt = secrets.data.find((secret) => secret.key === secretKey)?.updated_at ?? null
  return (
    <SecretField
      secretKey={secretKey}
      label={label}
      help={help}
      configuredAt={configuredAt}
      readOnly={readOnly || !can('settings.integrations_manage')}
    />
  )
}

/**
 * « Centrale téléphonique »: the address, the client id and the number in one form; the client secret under it.
 * They decide where the client secret is sent: read-only without `settings.integrations_manage` (the database refuses too).
 */
function PbxCard({ settings, readOnly }: { settings: SmsSettings } & CardProps) {
  const { can } = useAccess()
  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.pbx.title`)} description={t(`${S}.pbx.description`)}>
      <PbxForm settings={settings} readOnly={readOnly || !can('settings.integrations_manage')} />
      <SmsSecret secretKey="yeastar_client_secret" label={t(`${S}.pbx.clientSecret`)} help={t(`${S}.pbx.clientSecretHelp`)} readOnly={readOnly} />
    </SettingsCard>
  )
}

/** Read-only: Enter in a field would still submit the form implicitly; nothing may be saved. */
const preventSubmit = (event: FormEvent<HTMLFormElement>) => event.preventDefault()

function PbxForm({ settings, readOnly }: { settings: SmsSettings } & CardProps) {
  const values = useMemo(() => toPbxValues(settings), [settings])
  const { form, cancel, handleSave } = useSettingsForm({ schema: pbxSchema, values })
  const save = useSaveSmsSettings({ onErrorMessage: (message) => form.setError('root.server', { message }) })
  const { errors, isDirty } = form.formState
  useUnsavedChanges(isDirty && !readOnly)
  const onSubmit = handleSave((patch, onSaved) => save.mutate(patch, { onSuccess: (saved) => onSaved(toPbxValues(saved)) }))

  return (
    <form onSubmit={readOnly ? preventSubmit : (event) => void onSubmit(event)} noValidate aria-busy={save.isPending || undefined} className="space-y-3">
      <FormField label={t(`${S}.pbx.baseUrl`)} help={t(`${S}.pbx.baseUrlHelp`)} error={errors.baseUrl?.message} readOnly={readOnly}>
        {(field) => <Input {...field} {...form.register('baseUrl')} type="url" inputMode="url" placeholder="https://" autoComplete="off" spellCheck={false} />}
      </FormField>
      <FormField label={t(`${S}.pbx.clientId`)} help={t(`${S}.pbx.clientIdHelp`)} error={errors.clientId?.message} readOnly={readOnly}>
        {(field) => <Input {...field} {...form.register('clientId')} autoComplete="off" spellCheck={false} />}
      </FormField>
      <FormField label={t(`${S}.pbx.did`)} help={t(`${S}.pbx.didHelp`)} error={errors.did?.message} readOnly={readOnly}>
        {(field) => <Input {...field} {...form.register('did')} type="tel" inputMode="tel" autoComplete="off" className="tabular w-48 max-w-full" />}
      </FormField>
      {errors.root?.server?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.server.message}
        </p>
      )}
      {!readOnly && (
        <div className="flex justify-end gap-2 empty:hidden">
          <FormActions onCancel={cancel} onReset={() => form.setFocus('baseUrl')} dirty={isDirty} pending={save.isPending} />
        </div>
      )}
    </form>
  )
}

/** « Textos reçus »: the address to paste on the PBX, its secret, the last event received. */
function WebhookCard({ readOnly }: CardProps) {
  const { org_id: orgId } = useReadyAccess()
  const { can } = useAccess()
  const lastEvent = useLastYeastarEvent(can('settings.view'))
  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.webhook.title`)} description={t(`${S}.webhook.description`)}>
      <WebhookAddressField url={smsWebhookUrl(orgId)} label={t(`${S}.webhook.url`)} help={t(`${S}.webhook.urlHelp`)} />
      <SmsSecret secretKey="yeastar_webhook_secret" label={t(`${S}.webhook.secret`)} help={t(`${S}.webhook.secretHelp`)} readOnly={readOnly} />
      {can('settings.view') && (
        // Not a live region: what the page loaded, not the outcome of anything done here.
        <p className="text-sm text-muted-foreground">
          {lastEvent.isPending
            ? t('common.loading')
            : lastEvent.isError
              ? t(`${S}.webhook.lastEventError`)
              : lastEvent.data
                ? t(`${S}.webhook.lastEvent`, { date: formatClinicDateTime(lastEvent.data) })
                : t(`${S}.webhook.noEvent`)}
        </p>
      )}
    </SettingsCard>
  )
}

/** « Textes envoyés automatiquement »: the consent text (with ARRÊT) and the reply to a withdrawal. */
function TextsCard({ settings, readOnly }: { settings: SmsSettings } & CardProps) {
  const values = useMemo(() => toTextsValues(settings), [settings])
  const { form, cancel, handleSave } = useSettingsForm({ schema: textsSchema, values })
  const save = useSaveSmsSettings({ onErrorMessage: (message) => form.setError('root.server', { message }) })
  const { errors, isDirty } = form.formState
  useUnsavedChanges(isDirty && !readOnly)
  const onSubmit = handleSave((patch, onSaved) => save.mutate(patch, { onSuccess: (saved) => onSaved(toTextsValues(saved)) }))

  return (
    <SettingsCard
      layout="section"
      title={t(`${S}.texts.title`)}
      description={t(`${S}.texts.description`)}
      dirty={isDirty}
      readOnly={readOnly}
      pending={save.isPending}
      onSubmit={(event) => void onSubmit(event)}
      footer={<FormActions onCancel={cancel} onReset={() => form.setFocus('consentText')} dirty={isDirty} pending={save.isPending} />}
    >
      <FormField label={t(`${S}.texts.consentText`)} required help={t(`${S}.texts.consentHelp`)} error={errors.consentText?.message}>
        {(field) => <Textarea {...field} {...form.register('consentText')} rows={6} maxLength={480} />}
      </FormField>
      <FormField label={t(`${S}.texts.optOutReply`)} required help={t(`${S}.texts.optOutHelp`)} error={errors.optOutReply?.message}>
        {(field) => <Textarea {...field} {...form.register('optOutReply')} rows={3} maxLength={480} />}
      </FormField>
      {errors.root?.server?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.server.message}
        </p>
      )}
    </SettingsCard>
  )
}

/** « Envoi »: whether the dispatch job runs (« Activer » for `settings.manage`), and the test text. */
function SendCard({ readOnly }: CardProps) {
  const { can } = useAccess()
  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.send.title`)} description={t(`${S}.send.description`)}>
      {can('settings.view') && <DispatchJobState />}
      {!readOnly && <TestText />}
    </SettingsCard>
  )
}

/** The dispatch job is off by default, like every business job: say so, and offer to switch it on. */
function DispatchJobState() {
  const { can } = useAccess()
  const jobs = useScheduledJobs()
  const setEnabled = useSetScheduledJobEnabled()
  if (jobs.isError && !jobs.data) return <LoadError message={t(`${S}.send.jobLoadError`)} retrying={jobs.isFetching} onRetry={() => void jobs.refetch()} />
  if (!jobs.data) return <Loading />
  const job = jobs.data.find((j) => j.key === SMS_DISPATCH_JOB)
  if (!job) return <p className="text-sm text-muted-foreground">{t(`${S}.send.jobUnknown`)}</p>
  if (job.enabled) {
    return (
      <p className="flex items-start gap-2 text-sm text-foreground">
        <CircleCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
        {t(`${S}.send.jobOn`)}
      </p>
    )
  }
  const pending = setEnabled.isPending
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-2 text-sm text-foreground">
        <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning-strong" />
        {t(`${S}.send.jobOff`)}
      </p>
      {can('settings.manage') ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={pending || undefined}
          onClick={ignoreWhenInactive(pending, () => setEnabled.mutate({ key: SMS_DISPATCH_JOB, enabled: true }))}
          className={cn(softDisabledClasses, 'max-sm:h-11 aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
        >
          {pending ? t(`${S}.send.jobEnabling`) : t(`${S}.send.jobEnable`)}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t(`${S}.send.jobAskAdmin`)}{' '}
          <GuardedNavLink to={`${SETTINGS_BASE_PATH}/taches-planifiees`} className="text-link underline-offset-[3px] hover:underline">
            {t(`${S}.send.jobOpen`)}
          </GuardedNavLink>
        </p>
      )}
    </div>
  )
}

/** « Envoyer un texto de test » to a number typed here (communications.sms_manage, 5 an hour). */
function TestText() {
  const form = useForm<TestValues, unknown, { to: string }>({ resolver: zodResolver(testSchema), defaultValues: { to: '' } })
  const test = useSendSmsTest()
  const { errors } = form.formState
  const submit = form.handleSubmit((values) => test.mutate(values.to))
  return (
    <form noValidate onSubmit={(event) => void submit(event)} aria-busy={test.isPending || undefined} className="space-y-2 border-t border-border-light pt-3">
      <FormField label={t(`${S}.send.testTo`)} help={t(`${S}.send.testHelp`)} error={errors.to?.message}>
        {(field) => <Input {...field} {...form.register('to')} type="tel" inputMode="tel" autoComplete="off" className="tabular w-48 max-w-full" />}
      </FormField>
      <SaveButton pending={test.isPending} variant="outline" label={t(`${S}.send.test`)} pendingLabel={t(`${S}.send.testing`)} />
    </form>
  )
}

import { useMemo, useRef, useState, type FormEvent } from 'react'
import { CircleAlert, CircleCheck, Link2, RefreshCw } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { ScheduledJobState } from '@/core/jobs/components/ScheduledJobState'
import { SETTINGS_BASE_PATH } from '@/core/settings/paths'
import { SecretField } from '@/core/settings/components/SecretField'
import { WebhookAddressField } from '@/core/settings/components/WebhookAddressField'
import { useOrgSecretKeys } from '@/core/settings/secrets/hooks'
import { FormActions } from '@/shared/components/FormActions'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateFull, formatClinicDateTime } from '@/shared/lib/timezone'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
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
import { Select } from '@/shared/ui/select'
import { StatusDot } from '@/shared/ui/status-dot'
import { billingErrorMessage } from '../../api/errors'
import {
  ACCOUNT_MAP_KEYS,
  accountFits,
  QBO_ENVIRONMENTS,
  type AccountMapRow,
  type QboAccount,
  type QboConnection,
  type QboEnvironment,
  type QboSettings,
} from '../../api/quickbooks'
import { useDisconnectQbo, useQboSettings, useSaveAccountMapRow, useStartQboConnect, useSyncQbo } from '../../hooks/use-quickbooks'
import { connectionStatus, syncOutcome } from '../../lib/qbo-status'
import { QboPushCard } from './QboPushCard'

const Q = 'modules.billing.qbo'

/** The app path Intuit sends the browser back to (`_shared/qbo/env.ts` RETURN_PATH). */
const RETURN_PATH = '/facturation/retour-quickbooks'
/** The keep-alive job (maintenance: always on). */
const REFRESH_JOB = 'billing.qbo_token_refresh'
/** The secrets of the clinic's Intuit application (`_shared/qbo/env.ts`). */
const CLIENT_ID = 'qbo_client_id'
const CLIENT_SECRET = 'qbo_client_secret'

const PENDING_OUTLINE = cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card max-sm:h-11')

/**
 * Paramètres → QuickBooks (plan §8, FQ; `billing.settings`): the connection to the clinic's
 * QuickBooks Online company, its Intuit application, the accounts each kind of entry uses
 * (Christine's defaults suggested), and the job that keeps the connection alive. Nothing is sent to
 * QuickBooks yet: the invoices and payments come with Facturation (FQ-4).
 */
export function QuickBooksSettingsPage() {
  const { can } = useAccess()
  const settings = useQboSettings()
  let body
  if (settings.data) {
    body = (
      <>
        <ConnectionCard connection={settings.data.connection} />
        <AppCard readOnly={!can('settings.integrations_manage')} />
        <AccountsCard settings={settings.data} />
        <QboPushCard settings={settings.data} />
        <JobsCard canRead={can('settings.view')} />
      </>
    )
  } else if (settings.isError) {
    body = <LoadError message={t(`${Q}.loadError`)} retrying={settings.isFetching} onRetry={() => void settings.refetch()} />
  } else {
    body = <Loading />
  }
  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${Q}.title`)} description={t(`${Q}.description`)} />
      <SectionSurface>{body}</SectionSurface>
    </div>
  )
}

interface Outcome {
  ok: boolean
  text: string
}

/** The one live region of an action: always mounted, emptied when it starts again. */
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

/** « Connexion »: the company, its state, « Synchroniser », « Reconnecter », « Déconnecter »; or « Connecter QuickBooks ». */
function ConnectionCard({ connection }: { connection: QboConnection | null }) {
  const status = connectionStatus(connection)
  const connected = connection !== null && connection.status !== 'disconnected'
  const connect = useStartQboConnect()
  const sync = useSyncQbo()
  const [environment, setEnvironment] = useState<QboEnvironment>(connection?.environment ?? 'production')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const { can } = useAccess()
  const secrets = useOrgSecretKeys()
  const appMissing =
    can('settings.view') && secrets.data !== undefined && !(secrets.data.some((s) => s.key === CLIENT_ID) && secrets.data.some((s) => s.key === CLIENT_SECRET))

  const runSync = () => {
    setOutcome(null)
    sync.mutate(undefined, {
      onSuccess: (result) => setOutcome(syncOutcome(result)),
      onError: (error) => setOutcome({ ok: false, text: billingErrorMessage(error) }),
    })
  }

  if (!connected) {
    return (
      <SettingsCard as="section" layout="section" title={t(`${Q}.connection.title`)} description={t(`${Q}.connection.description`)}>
        <p className="inline-flex items-center gap-1.5 text-sm text-foreground">
          <StatusDot tone={status.tone} />
          {status.label}
        </p>
        <FormField label={t(`${Q}.connection.environment`)} help={t(`${Q}.connection.environmentHelp`)}>
          {(field) => (
            <Select {...field} value={environment} onChange={(event) => setEnvironment(event.target.value as QboEnvironment)}>
              {QBO_ENVIRONMENTS.map((env) => (
                <option key={env} value={env}>
                  {t(`${Q}.environments.${env}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <div className="space-y-1 border-t border-border-light pt-3">
          <Button
            type="button"
            variant="outline"
            aria-disabled={connect.isPending || undefined}
            onClick={ignoreWhenInactive(connect.isPending, () => connect.mutate(environment))}
            className={PENDING_OUTLINE}
          >
            <Link2 aria-hidden className="size-3.5" />
            {connect.isPending ? t(`${Q}.connection.connecting`) : t(`${Q}.connection.connect`)}
          </Button>
          <p className="text-xs text-muted-foreground">{appMissing ? t(`${Q}.connection.appMissing`) : t(`${Q}.connection.connectHelp`)}</p>
        </div>
      </SettingsCard>
    )
  }

  return (
    <SettingsCard as="section" layout="section" title={t(`${Q}.connection.title`)} description={t(`${Q}.connection.description`)}>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 font-medium text-foreground">{connection.company_name ?? t(`${Q}.connection.unnamed`)}</span>
          <Badge variant={connection.environment === 'sandbox' ? 'warning' : 'outline'}>{t(`${Q}.environments.${connection.environment}`)}</Badge>
          <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
            <StatusDot tone={status.tone} />
            {status.label}
          </span>
        </div>
        {status.detail && <p className="text-xs text-muted-foreground">{status.detail}</p>}
        <p className="text-xs text-muted-foreground">
          {t(`${Q}.connection.connectedBy`, {
            date: formatClinicDateTime(connection.connected_at),
            name: connection.connected_by_name ?? t(`${Q}.connection.someone`),
          })}
        </p>
        <p className="text-xs text-muted-foreground">
          {connection.last_sync_at ? t(`${Q}.connection.lastSync`, { date: formatClinicDateTime(connection.last_sync_at) }) : t(`${Q}.connection.neverSynced`)}
        </p>
        {connection.refresh_token_expires_at && connection.status === 'connected' && (
          <p className="text-xs text-muted-foreground">
            {t(`${Q}.connection.expires`, { date: formatClinicDateFull(connection.refresh_token_expires_at) })}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-light pt-3">
        {connection.status === 'connected' ? (
          <Button type="button" variant="outline" size="sm" aria-disabled={sync.isPending || undefined} onClick={ignoreWhenInactive(sync.isPending, runSync)} className={PENDING_OUTLINE}>
            <RefreshCw aria-hidden className={cn('size-3.5', sync.isPending && 'motion-safe:animate-spin')} />
            {sync.isPending ? t(`${Q}.connection.syncing`) : t(`${Q}.connection.sync`)}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={connect.isPending || undefined}
            onClick={ignoreWhenInactive(connect.isPending, () => connect.mutate(connection.environment))}
            className={PENDING_OUTLINE}
          >
            {connect.isPending ? t(`${Q}.connection.connecting`) : t(`${Q}.connection.reconnect`)}
          </Button>
        )}
        <DisconnectButton company={connection.company_name ?? t(`${Q}.connection.unnamed`)} />
        <OutcomeStatus outcome={outcome} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t(`${Q}.connection.customersHint`)}{' '}
        <GuardedNavLink to={`${SETTINGS_BASE_PATH}/quickbooks-clients`} className="text-link underline-offset-[3px] hover:underline">
          {t(`${Q}.customers.title`)}
        </GuardedNavLink>
      </p>
    </SettingsCard>
  )
}

/** « Déconnecter », confirmed: the access at Intuit revoked; the accounts map and the mapping stay. */
function DisconnectButton({ company }: { company: string }) {
  const disconnect = useDisconnectQbo()
  const confirmed = useRef(false)
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-disabled={disconnect.isPending || undefined} className={cn(softDisabledClasses, 'max-sm:h-11')}>
          {disconnect.isPending ? t(`${Q}.connection.disconnecting`) : t(`${Q}.connection.disconnect`)}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!confirmed.current) return
          event.preventDefault()
          confirmed.current = false
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${Q}.connection.disconnectConfirm.title`, { company })}</AlertDialogTitle>
          <AlertDialogDescription>{t(`${Q}.connection.disconnectConfirm.body`)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: 'destructive' })}
            onClick={() => {
              confirmed.current = true
              if (!disconnect.isPending) disconnect.mutate()
            }}
          >
            {t(`${Q}.connection.disconnectConfirm.action`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** One org secret's state, with « Remplacer » or « Ajouter ». */
function OrgSecret({ secretKey, label, help, readOnly }: { secretKey: string; label: string; help: string; readOnly: boolean }) {
  const { can } = useAccess()
  const secrets = useOrgSecretKeys()
  if (!can('settings.view')) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{t(`${Q}.app.secretsUnknown`)}</p>
      </div>
    )
  }
  if (secrets.isPending) return <Loading />
  if (secrets.isError && !secrets.data) {
    return <LoadError message={t(`${Q}.app.secretsLoadError`)} retrying={secrets.isFetching} onRetry={() => void secrets.refetch()} />
  }
  const configuredAt = secrets.data.find((secret) => secret.key === secretKey)?.updated_at ?? null
  return <SecretField secretKey={secretKey} label={label} help={help} configuredAt={configuredAt} readOnly={readOnly} />
}

/** « Application Intuit »: the clinic's application and the return address to declare at Intuit. */
function AppCard({ readOnly }: { readOnly: boolean }) {
  return (
    <SettingsCard as="section" layout="section" title={t(`${Q}.app.title`)} description={t(`${Q}.app.description`)}>
      <OrgSecret secretKey={CLIENT_ID} label={t(`${Q}.app.clientId`)} help={t(`${Q}.app.clientIdHelp`)} readOnly={readOnly} />
      <OrgSecret secretKey={CLIENT_SECRET} label={t(`${Q}.app.clientSecret`)} help={t(`${Q}.app.clientSecretHelp`)} readOnly={readOnly} />
      <WebhookAddressField url={`${window.location.origin}${RETURN_PATH}`} label={t(`${Q}.app.redirect`)} help={t(`${Q}.app.redirectHelp`)} />
      {readOnly && <p className="text-xs text-muted-foreground">{t(`${Q}.app.readOnly`)}</p>}
    </SettingsCard>
  )
}

/** A map row's stable id in the form. */
const rowId = (row: Pick<AccountMapRow, 'key' | 'profession_title_id'>) => `${row.key}:${row.profession_title_id ?? ''}`

/** « 1075 · Virement bancaire à recevoir ». */
function accountLabel(account: QboAccount): string {
  const name = account.fully_qualified_name ?? account.name
  return account.acct_num ? `${account.acct_num} · ${name}` : name
}

/** « Comptes »: which account each kind of entry uses. */
function AccountsCard({ settings }: { settings: QboSettings }) {
  const connected = settings.connection !== null && settings.connection.status !== 'disconnected'
  let content
  if (!connected) content = <p className="text-sm text-muted-foreground">{t(`${Q}.accounts.connectFirst`)}</p>
  else if (settings.accounts.length === 0) content = <p className="text-sm text-muted-foreground">{t(`${Q}.accounts.syncFirst`)}</p>
  // Remounted when the saved map changes, so the form starts from what is stored.
  else content = <AccountMapForm key={JSON.stringify(settings.map)} settings={settings} />
  return (
    <SettingsCard as="section" layout="section" title={t(`${Q}.accounts.title`)} description={t(`${Q}.accounts.description`)}>
      {content}
    </SettingsCard>
  )
}

/** Read-only: Enter would still submit the form implicitly; nothing may be saved twice. */
const preventSubmit = (event: FormEvent<HTMLFormElement>) => event.preventDefault()

function AccountMapForm({ settings }: { settings: QboSettings }) {
  const initial = useMemo(() => Object.fromEntries(settings.map.map((row) => [rowId(row), row.account_id ?? ''])), [settings.map])
  const [values, setValues] = useState<Record<string, string>>(initial)
  const [error, setError] = useState<string | null>(null)
  const save = useSaveAccountMapRow()
  const [pending, setPending] = useState(false)
  const changed = settings.map.filter((row) => (values[rowId(row)] ?? '') !== (initial[rowId(row)] ?? ''))
  const dirty = changed.length > 0
  useUnsavedChanges(dirty)
  const firstSelect = useRef<HTMLSelectElement>(null)

  // The revenue rows, then one deposit row per payment mode that lands money (in the modes' order).
  const fixed = settings.map.filter((row) => row.key !== 'expense' && !row.key.startsWith('tax.') && row.profession_title_id === null)
  // FQ part 2: the tax codes the push puts on its lines.
  const taxes = settings.map.filter((row) => row.key.startsWith('tax.'))
  const expenses = settings.map.filter((row) => row.key === 'expense')
  const missing = settings.map.filter((row) => !(values[rowId(row)] ?? '')).length

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setPending(true)
    try {
      // Only the rows changed: an untouched suggestion stays a suggestion.
      for (const row of changed) {
        await save.mutateAsync({ key: row.key, professionTitleId: row.profession_title_id, accountId: values[rowId(row)] || null })
      }
    } catch (failure) {
      setError(billingErrorMessage(failure, t(`${Q}.accounts.saveError`)))
    } finally {
      setPending(false)
    }
  }

  const row = (mapRow: AccountMapRow, index: number, label: string, help: string) => {
    const id = rowId(mapRow)
    const choices = mapRow.key.startsWith('tax.')
      ? settings.tax_codes.map((code) => ({ id: code.id, label: code.name }))
      : settings.accounts.filter((account) => accountFits(mapRow.key, account.account_type)).map((account) => ({ id: account.id, label: accountLabel(account) }))
    const value = values[id] ?? ''
    return (
      <FormField key={id} label={label} help={help}>
        {(field) => (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              {...field}
              ref={index === 0 ? firstSelect : undefined}
              value={value}
              onChange={(event) => setValues((prev) => ({ ...prev, [id]: event.target.value }))}
              className="min-w-0 flex-1 sm:max-w-md"
            >
              <option value="">{t(`${Q}.accounts.none`)}</option>
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </Select>
            {mapRow.suggested && value === (initial[id] ?? '') && value !== '' && <Badge variant="info">{t(`${Q}.accounts.suggested`)}</Badge>}
          </div>
        )}
      </FormField>
    )
  }

  return (
    <form onSubmit={pending ? preventSubmit : (event) => void onSubmit(event)} noValidate aria-busy={pending || undefined} className="space-y-4">
      {missing > 0 && (
        <p className="text-sm text-foreground">
          {t(missing === 1 ? `${Q}.accounts.missingOne` : `${Q}.accounts.missingOther`, { count: String(missing) })}
        </p>
      )}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-foreground">{t(`${Q}.accounts.revenueAndDeposits`)}</legend>
        {fixed.map((mapRow, index) => {
          if (!(ACCOUNT_MAP_KEYS as readonly string[]).includes(mapRow.key)) {
            // A payment mode the clinic added: its own name.
            return row(mapRow, index, t(`${Q}.accounts.depositOther`, { mode: mapRow.mode_name ?? mapRow.key }), t(`${Q}.accounts.depositOtherHelp`))
          }
          // « revenue.services » → the label of « revenue_services » (a dot would be a path in t()).
          const id = mapRow.key.replace('.', '_')
          return row(mapRow, index, t(`${Q}.accounts.keys.${id}.label` as never), t(`${Q}.accounts.keys.${id}.help` as never))
        })}
      </fieldset>
      {taxes.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-foreground">{t(`${Q}.accounts.taxes`)}</legend>
          {taxes.map((mapRow) =>
            row(
              mapRow,
              -1,
              t(mapRow.key === 'tax.taxable' ? `${Q}.accounts.keys.tax_taxable.label` : `${Q}.accounts.keys.tax_exempt.label`),
              t(mapRow.key === 'tax.taxable' ? `${Q}.accounts.keys.tax_taxable.help` : `${Q}.accounts.keys.tax_exempt.help`),
            ),
          )}
        </fieldset>
      )}
      {expenses.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-foreground">{t(`${Q}.accounts.expenses`)}</legend>
          <p className="text-xs text-muted-foreground">{t(`${Q}.accounts.expensesHelp`)}</p>
          {expenses.map((mapRow) =>
            row(mapRow, -1, mapRow.profession_title_name ?? t(`${Q}.accounts.unknownTitle`), t(`${Q}.accounts.expenseHelp`)),
          )}
        </fieldset>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 empty:hidden">
        <FormActions onCancel={() => setValues(initial)} onReset={() => firstSelect.current?.focus()} dirty={dirty} pending={pending} />
      </div>
    </form>
  )
}

/** « Tâches planifiées »: the keep-alive (maintenance, always on). */
function JobsCard({ canRead }: { canRead: boolean }) {
  return (
    <SettingsCard as="section" layout="section" title={t(`${Q}.jobs.title`)} description={t(`${Q}.jobs.description`)}>
      {canRead ? <ScheduledJobState jobKey={REFRESH_JOB} texts={`${Q}.jobs.refresh`} /> : <p className="text-sm text-muted-foreground">{t(`${Q}.jobs.unknown`)}</p>}
    </SettingsCard>
  )
}

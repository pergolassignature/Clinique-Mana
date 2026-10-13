import { useMemo, useState } from 'react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { ScheduledJobState } from '@/core/jobs/components/ScheduledJobState'
import { SecretField } from '@/core/settings/components/SecretField'
import { WebhookAddressField } from '@/core/settings/components/WebhookAddressField'
import { useSettingsSection } from '@/core/settings/section-context'
import { useOrgSecretKeys } from '@/core/settings/secrets/hooks'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { Button } from '@/shared/ui/button'
import { StatusDot } from '@/shared/ui/status-dot'
import type { ProfessionalName, VideoSetup } from '../../api/video'
import { FixedLinkForm } from '../../components/video/FixedLinkForm'
import { useProfessionalNames, useProfessionalVideoStatus } from '../../hooks/use-video'
import { videoReadiness, videoReadinessLabel, zoomDetail, zoomWebhookUrl, ZOOM_RETURN_PATH, type VideoReadiness } from '../../lib/video'

const S = 'modules.appointments.video.settings'
const SYNC_JOB = 'appointments.video_sync'

const FILTERS = ['all', 'zoom', 'fixed', 'reconnect', 'none'] as const
type Filter = (typeof FILTERS)[number]

interface Row {
  id: string
  name: string
  setup: VideoSetup | null
  readiness: VideoReadiness
}

/**
 * Paramètres → Vidéoconférence (RZ; seen with `appointments.view`, fixed links changed with
 * `appointments.manage`): who is ready for video appointments (R-55) — each active professional
 * with « Zoom connecté », « Zoom à reconnecter », « Lien fixe » or « Aucun lien vidéo », a filter, and
 * her fixed link to enter for her when she cannot; the clinic's Zoom app (write-only secrets,
 * `settings.integrations_manage`), the addresses to give Zoom; the job that makes the meetings.
 */
export function VideoSettingsPage() {
  const { readOnly } = useSettingsSection()
  const { can } = useAccess()
  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${S}.title`)} description={t(`${S}.description`)} />
      {readOnly && <ReadOnlyNotice />}
      <SectionSurface>
        <ProfessionalsCard readOnly={readOnly} />
        <ZoomAppCard readOnly={!can('settings.integrations_manage')} />
        <SettingsCard as="section" layout="section" title={t(`${S}.job.title`)} description={t(`${S}.job.description`)}>
          {can('settings.view') ? (
            <ScheduledJobState jobKey={SYNC_JOB} texts={`${S}.job.sync`} />
          ) : (
            <p className="text-sm text-muted-foreground">{t(`${S}.job.unknown`)}</p>
          )}
        </SettingsCard>
      </SectionSurface>
    </div>
  )
}

/** The rows: the active professionals by name (the directory), each with her setup. */
function useRows(): { rows: Row[] | null; error: boolean; retry: () => void; retrying: boolean } {
  const { can } = useAccess()
  const names = useProfessionalNames(can('professionals.view'))
  const statuses = useProfessionalVideoStatus()
  const rows = useMemo(() => {
    if (!statuses.data || (can('professionals.view') && !names.data)) return null
    const byId = new Map(statuses.data.map((s) => [s.professional_id, s]))
    const people: ProfessionalName[] = (names.data ?? []).filter((p) => p.status === 'active')
    return people.map((p) => {
      const setup = byId.get(p.id) ?? null
      return { id: p.id, name: p.display_name, setup, readiness: videoReadiness(setup) }
    })
  }, [statuses.data, names.data, can])
  return {
    rows,
    error: (statuses.isError && !statuses.data) || (names.isError && !names.data),
    retry: () => {
      void statuses.refetch()
      void names.refetch()
    },
    retrying: statuses.isFetching || names.isFetching,
  }
}

/** « Professionnels »: who is ready, a filter, and « Lien fixe » per professional. */
function ProfessionalsCard({ readOnly }: { readOnly: boolean }) {
  const { can } = useAccess()
  const { rows, error, retry, retrying } = useRows()
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | null>(null)

  let content
  if (!can('professionals.view')) {
    content = <p className="text-sm text-muted-foreground">{t(`${S}.list.noNames`)}</p>
  } else if (error) {
    content = <LoadError message={t(`${S}.list.loadError`)} retrying={retrying} onRetry={retry} />
  } else if (!rows) {
    content = <Loading />
  } else if (rows.length === 0) {
    content = <p className="text-sm text-muted-foreground">{t(`${S}.list.empty`)}</p>
  } else {
    const count = (f: Filter) => (f === 'all' ? rows.length : rows.filter((r) => r.readiness === f).length)
    const shown = filter === 'all' ? rows : rows.filter((r) => r.readiness === filter)
    const ready = rows.filter((r) => r.readiness === 'zoom' || r.readiness === 'fixed').length
    content = (
      <div className="space-y-3">
        <p className="text-sm text-foreground">{t(`${S}.list.summary`, { ready: String(ready), total: String(rows.length) })}</p>
        <div className="max-w-full overflow-x-auto">
          <SegmentedToggle
            label={t(`${S}.list.filterLabel`)}
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((value) => ({
              value,
              label: t(`${S}.list.filter`, { label: t(`${S}.list.filters.${value}`), count: String(count(value)) }),
            }))}
          />
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${S}.list.emptyFilter`)}</p>
        ) : (
          <ul className="divide-y divide-border-light border-y border-border-light">
            {shown.map((row) => {
              const status = videoReadinessLabel(row.readiness)
              const detail = row.setup ? zoomDetail(row.setup) : null
              return (
                <li key={row.id} className="space-y-2 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium text-foreground">{row.name}</p>
                      <p className="inline-flex items-center gap-1.5 text-sm text-foreground">
                        <StatusDot tone={status.tone} />
                        {status.label}
                      </p>
                      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
                      {row.setup?.fixed_url && (
                        <p className="break-all text-xs text-muted-foreground">{t(`${S}.list.fixedLink`, { url: row.setup.fixed_url })}</p>
                      )}
                    </div>
                    {!readOnly && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="self-start"
                        aria-expanded={open === row.id}
                        aria-label={t(row.setup?.fixed_url ? `${S}.list.editFixedFor` : `${S}.list.addFixedFor`, { name: row.name })}
                        onClick={() => setOpen(open === row.id ? null : row.id)}
                      >
                        {open === row.id ? t(`${S}.list.close`) : t(row.setup?.fixed_url ? `${S}.list.editFixed` : `${S}.list.addFixed`)}
                      </Button>
                    )}
                  </div>
                  {open === row.id && (
                    <FixedLinkForm
                      professionalId={row.id}
                      current={row.setup?.fixed_url ?? null}
                      readOnly={readOnly}
                      title={t(`${S}.list.fixedTitle`, { name: row.name })}
                      description={t(`${S}.list.fixedDescription`)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }
  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.list.title`)} description={t(`${S}.list.description`)}>
      {content}
    </SettingsCard>
  )
}

/** A write-only org secret of the Zoom app (« Configurée le … », never the value). */
function OrgSecret({ secretKey, label, help, readOnly }: { secretKey: string; label: string; help: string; readOnly: boolean }) {
  const { can } = useAccess()
  const secrets = useOrgSecretKeys()
  if (!can('settings.view')) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{t(`${S}.app.secretsUnknown`)}</p>
      </div>
    )
  }
  if (secrets.isPending) return <Loading />
  if (secrets.isError && !secrets.data) {
    return <LoadError message={t(`${S}.app.secretsLoadError`)} retrying={secrets.isFetching} onRetry={() => void secrets.refetch()} />
  }
  const configuredAt = secrets.data.find((secret) => secret.key === secretKey)?.updated_at ?? null
  return <SecretField secretKey={secretKey} label={label} help={help} configuredAt={configuredAt} readOnly={readOnly} />
}

/** « Application Zoom »: its client id and secret, its secret token, and the two addresses to give Zoom. */
function ZoomAppCard({ readOnly }: { readOnly: boolean }) {
  const { org_id: orgId } = useReadyAccess()
  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.app.title`)} description={t(`${S}.app.description`)}>
      <OrgSecret secretKey="zoom_client_id" label={t(`${S}.app.clientId`)} help={t(`${S}.app.clientIdHelp`)} readOnly={readOnly} />
      <OrgSecret secretKey="zoom_client_secret" label={t(`${S}.app.clientSecret`)} help={t(`${S}.app.clientSecretHelp`)} readOnly={readOnly} />
      <OrgSecret secretKey="zoom_webhook_secret" label={t(`${S}.app.webhookSecret`)} help={t(`${S}.app.webhookSecretHelp`)} readOnly={readOnly} />
      <WebhookAddressField url={`${window.location.origin}${ZOOM_RETURN_PATH}`} label={t(`${S}.app.redirect`)} help={t(`${S}.app.redirectHelp`)} />
      <WebhookAddressField url={zoomWebhookUrl(orgId)} label={t(`${S}.app.webhook`)} help={t(`${S}.app.webhookHelp`)} />
      {readOnly && <p className="text-xs text-muted-foreground">{t(`${S}.app.readOnly`)}</p>}
    </SettingsCard>
  )
}

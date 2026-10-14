import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { ScheduledJobState } from '@/core/jobs/components/ScheduledJobState'
import { WebhookAddressField } from '@/core/settings/components/WebhookAddressField'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { CALENDAR_RETURN_PATH } from '../../lib/calendar'
import { OrgSecretField } from '../settings/OrgSecretField'

const G = 'modules.appointments.calendar.settings'
/** The job that reads the busy times (`_shared/google-calendar`, AP-42). */
export const CALENDAR_SYNC_JOB = 'appointments.google_busy_sync'

/**
 * « Agendas Google des professionnels » in Paramètres → Agenda (R6, AP-46): the calendars' own
 * Google application (client id and secret, write-only, `settings.integrations_manage`), used when
 * both are set, else Gmail's (« Courriels Gmail »); the return address to give Google; the job that
 * reads the busy times.
 */
export function GoogleCalendarAppCard() {
  const { can } = useAccess()
  const readOnly = !can('settings.integrations_manage')
  return (
    <SettingsCard as="section" layout="section" title={t(`${G}.title`)} description={t(`${G}.description`)}>
      <OrgSecretField secretKey="google_calendar_client_id" label={t(`${G}.clientId`)} help={t(`${G}.clientIdHelp`)} readOnly={readOnly} />
      <OrgSecretField secretKey="google_calendar_client_secret" label={t(`${G}.clientSecret`)} help={t(`${G}.clientSecretHelp`)} readOnly={readOnly} />
      <WebhookAddressField url={`${window.location.origin}${CALENDAR_RETURN_PATH}`} label={t(`${G}.redirect`)} help={t(`${G}.redirectHelp`)} />
      {readOnly && <p className="text-xs text-muted-foreground">{t(`${G}.readOnly`)}</p>}
      <div className="space-y-1 pt-1">
        <p className="text-sm font-medium text-foreground">{t(`${G}.jobTitle`)}</p>
        {can('settings.view') ? (
          <ScheduledJobState jobKey={CALENDAR_SYNC_JOB} texts={`${G}.job`} />
        ) : (
          <p className="text-sm text-muted-foreground">{t(`${G}.jobUnknown`)}</p>
        )}
      </div>
    </SettingsCard>
  )
}

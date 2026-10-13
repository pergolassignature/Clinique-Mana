import { t } from '@/i18n'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { eventText } from '../../lib/history'
import { useDemandeRecord } from './record-context'

const H = 'modules.demandes.history'

/** « Historique »: what happened to the request, newest first, by whom and when. */
export function HistoryTab() {
  const { bundle } = useDemandeRecord()
  return (
    <SectionSurface>
      <SettingsCard as="section" layout="section" title={t(`${H}.title`)} description={t(`${H}.description`)}>
        {bundle.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${H}.empty`)}</p>
        ) : (
          <ol aria-label={t(`${H}.title`)} className="space-y-2">
            {bundle.events.map((event) => (
              <li key={event.id} className="text-sm">
                <p className="text-foreground">{eventText(event)}</p>
                <p className="text-xs text-muted-foreground">
                  {event.by_name ? t(`${H}.by`, { date: formatClinicDateTime(event.at), name: event.by_name }) : formatClinicDateTime(event.at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </SettingsCard>
    </SectionSurface>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { Button } from '@/shared/ui/button'
import { StatusDot } from '@/shared/ui/status-dot'
import { useDemandeWaitlist } from '../../hooks/use-waitlist'
import { consentLabel, consentSettled, entryStateLabel, entryStateTone, exitReasonLabel, feeLabel, feeSettled, rankLabel, waitedLabel, waitlistPath } from '../../lib/waitlist'
import { EntrySheet } from '../waitlist/EntrySheet'
import { RegisterWaitlistDialog } from '../waitlist/RegisterWaitlistDialog'
import { useDemandeRecord } from './record-context'

const W = 'modules.demandes.waitlist'
const C = `${W}.card`

/**
 * « Liste d'attente » in Suivi (D3): the request's entries — the list, the rank, the days waited,
 * complete or not — each opening its side sheet; « Inscrire sur la liste d'attente » while the
 * request is open (demandes.waitlist).
 */
export function WaitlistCard() {
  const { id, bundle } = useDemandeRecord()
  const { can } = useAccess()
  const entries = useDemandeWaitlist(id)
  const [registering, setRegistering] = useState(false)
  const [openEntry, setOpenEntry] = useState<string | null>(null)
  const d = bundle.demande
  const canRegister = can('demandes.waitlist') && d.state !== 'matched' && d.state !== 'closed'
  const rows = entries.data ?? []

  return (
    <SettingsCard as="section" layout="section" title={t(`${C}.title`)} description={t(`${C}.description`)}>
      {entries.isError && !entries.data ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`${C}.loadError`)}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{entries.data ? t(`${C}.none`) : t('common.loading')}</p>
      ) : (
        <ul aria-label={t(`${C}.title`)} className="divide-y divide-border-light">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0 space-y-0.5 text-sm">
                <p className="font-medium">
                  <Link to={waitlistPath({ kind: row.target_kind, id: row.target_id })} className="text-link underline-offset-2 hover:underline">
                    {row.target_name}
                  </Link>
                  {rankLabel(row) && <span className="tabular ml-2 font-normal text-muted-foreground">{rankLabel(row)}</span>}
                </p>
                <p className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    <StatusDot tone={entryStateTone(row.state)} />
                    {entryStateLabel(row.state)}
                    {row.exit_reason && ` · ${exitReasonLabel(row.exit_reason)}`}
                  </span>
                  {row.state !== 'closed' && <span className="text-muted-foreground">{waitedLabel(row.waited_days)}</span>}
                </p>
                {row.state !== 'closed' && (
                  <p className="inline-flex flex-wrap items-center gap-x-3 text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <StatusDot tone={consentSettled(row.consent_state) ? 'success' : 'warning'} />
                      {row.consent_state ? consentLabel(row.consent_state) : t(`${W}.consent.none`)}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <StatusDot tone={feeSettled(row.fee_status) ? 'success' : 'warning'} />
                      {feeLabel(row.fee_status)}
                    </span>
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpenEntry(row.id)}
                aria-label={t(`${C}.openFor`, { list: row.target_name ?? '' })}
                className="max-sm:h-11"
              >
                {t(`${C}.open`)}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {canRegister && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRegistering(true)} className="max-sm:h-11">
            {t(`${W}.register.open`)}
          </Button>
        </div>
      )}
      <RegisterWaitlistDialog demandeId={id} hasFile={bundle.client !== null} open={registering} onOpenChange={setRegistering} />
      <EntrySheet entryId={openEntry} onClose={() => setOpenEntry(null)} />
    </SettingsCard>
  )
}

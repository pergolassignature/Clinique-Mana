import { t } from '@/i18n'

const S = 'modules.demandes.sources'
const CHANNELS = ['phone', 'email', 'web_form', 'booking_page', 'sms', 'referral', 'walk_in', 'other'] as const
type Channel = (typeof CHANNELS)[number]

/** What `get_demande` gives of a request's source (its columns, snake_case). */
export interface DemandeSource {
  channel: string
  referral_source_id: string | null
  source_campaign: string | null
  source_utm: Record<string, string> | null
  source_referrer: string | null
  source_landing_page: string | null
}

/**
 * « Provenance » (Demandes D3c, R-74): where a request came from, for the counselor — the channel,
 * the « Comment avez-vous entendu parler de MANA ? » answer, the campaign and its utm_* parameters,
 * the referrer and the landing page. The record (D2) mounts it; the same fields are reportable
 * through the view `demandes_sources` (D6). Read only.
 */
export function DemandeSourceCard({ demande, referralSourceName = null }: { demande: DemandeSource; referralSourceName?: string | null }) {
  const channel = (CHANNELS as readonly string[]).includes(demande.channel)
    ? t(`modules.demandes.audit.values.demandes.channel.${demande.channel as Channel}`)
    : demande.channel
  const utm = Object.entries(demande.source_utm ?? {}).filter(([, v]) => typeof v === 'string' && v !== '')
  const rows: [string, string | null][] = [
    [t(`${S}.channel`), channel],
    [t(`${S}.heard`), referralSourceName],
    [t(`${S}.campaign`), demande.source_campaign],
    [t(`${S}.utm`), utm.length > 0 ? utm.map(([k, v]) => `${k.replace(/^utm_/, '')} : ${v}`).join(' · ') : null],
    [t(`${S}.referrer`), demande.source_referrer],
    [t(`${S}.landing`), demande.source_landing_page],
  ]
  return (
    <section aria-labelledby="demande-source-title" className="space-y-2">
      <h3 id="demande-source-title" className="text-sm font-semibold text-foreground">
        {t(`${S}.title`)}
      </h3>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-foreground">{value ?? <span className="text-muted-foreground">{t(`${S}.none`)}</span>}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Pencil } from 'lucide-react'
import { t } from '@/i18n'
import { FormActions } from '@/shared/components/FormActions'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { Button } from '@/shared/ui/button'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'

const S = 'modules.demandes.sources'
export const SOURCE_CHANNELS = ['phone', 'email', 'web_form', 'booking_page', 'sms', 'referral', 'walk_in', 'other'] as const
type Channel = (typeof SOURCE_CHANNELS)[number]

/** What `get_demande` gives of a request's source (its columns, snake_case). */
export interface DemandeSource {
  channel: string
  referral_source_id: string | null
  source_campaign: string | null
  source_utm: Record<string, string> | null
  source_referrer: string | null
  source_landing_page: string | null
}

interface DemandeSourceCardProps {
  demande: DemandeSource
  /** The clinic's referral sources (Clients' `referral_sources_catalog`). */
  referralSources?: readonly { id: string; name: string }[]
  /** The declared source's name, when it is no longer in the list (archived since). */
  referralSourceName?: string | null
  /** « Modifier » (demandes.manage): the channel and the declared source only (D-26). */
  onSave?: (values: { channel: string; referralSourceId: string | null }) => Promise<void>
}

const channelLabel = (channel: string) =>
  (SOURCE_CHANNELS as readonly string[]).includes(channel) ? t(`modules.demandes.audit.values.demandes.channel.${channel as Channel}`) : channel

/**
 * « Provenance » (Demandes D3c, R-74; D-26): where a request came from — the channel and the
 * declared source (« Provenance déclarée », the answer to « Comment la personne a entendu parler de
 * MANA ? »), which a counselor corrects with « Modifier »; then what the booking page captured on
 * its own (campaign, utm_* parameters, referrer, landing page), read only and shown only when
 * known. The same fields are reportable through the view `demandes_sources` (D6).
 */
export function DemandeSourceCard({ demande, referralSources = [], referralSourceName = null, onSave }: DemandeSourceCardProps) {
  const [editing, setEditing] = useState(false)
  const editButton = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false
      editButton.current?.focus()
    }
  }, [editing])
  const close = () => {
    returnFocus.current = true
    setEditing(false)
  }

  const heard =
    (demande.referral_source_id ? referralSources.find((s) => s.id === demande.referral_source_id)?.name : null) ?? referralSourceName
  const utm = Object.entries(demande.source_utm ?? {}).filter(([, v]) => typeof v === 'string' && v !== '')
  // What the booking page recorded on its own: a fact, never edited; empty lines are left out.
  const captured: [string, string][] = (
    [
      [t(`${S}.campaign`), demande.source_campaign],
      [t(`${S}.utm`), utm.length > 0 ? utm.map(([k, v]) => `${utmLabel(k)} : ${v}`).join(' · ') : null],
      [t(`${S}.referrer`), demande.source_referrer],
      [t(`${S}.landing`), pageOf(demande.source_landing_page)],
    ] as [string, string | null][]
  ).filter((row): row is [string, string] => row[1] !== null && row[1].trim() !== '')

  return (
    <section aria-labelledby="demande-source-title" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="demande-source-title" className="text-sm font-semibold text-foreground">
          {t(`${S}.title`)}
        </h3>
        {onSave && !editing && (
          <Button ref={editButton} type="button" variant="outline" size="sm" onClick={() => setEditing(true)} className="max-sm:h-11">
            <Pencil aria-hidden className="size-3.5" />
            {t(`${S}.edit`)}
          </Button>
        )}
      </div>
      {editing && onSave ? (
        <SourceForm demande={demande} referralSources={referralSources} heardName={heard} onSave={onSave} onClose={close} />
      ) : (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          <Row label={t(`${S}.channel`)} value={channelLabel(demande.channel)} />
          <div className="contents">
            <dt className="text-muted-foreground">
              <span title={t(`${S}.heardQuestion`)}>{t(`${S}.heard`)}</span>
              <span className="sr-only"> ({t(`${S}.heardQuestion`)})</span>
            </dt>
            <dd className="min-w-0 break-words text-foreground">{heard ?? <span className="text-muted-foreground">{t(`${S}.notSaid`)}</span>}</dd>
          </div>
          {captured.map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
        </dl>
      )}
      {!editing && captured.length === 0 && demande.channel !== 'booking_page' && (
        <p className="text-xs text-muted-foreground">{t(`${S}.noCampaign`)}</p>
      )}
    </section>
  )
}

const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const

/** « utm_campaign » → « Campagne »: the campaign's parameters in plain French. */
function utmLabel(key: string): string {
  const short = key.replace(/^utm_/, '')
  return (UTM_KEYS as readonly string[]).includes(short) ? t(`${S}.utmKeys.${short as (typeof UTM_KEYS)[number]}`) : short
}

/** The page's address without the site and its technical parameters (« /appel-decouverte »). */
function pageOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{value}</dd>
    </div>
  )
}

function SourceForm({
  demande,
  referralSources,
  heardName,
  onSave,
  onClose,
}: {
  demande: DemandeSource
  referralSources: readonly { id: string; name: string }[]
  heardName: string | null
  onSave: NonNullable<DemandeSourceCardProps['onSave']>
  onClose: () => void
}) {
  const id = useId()
  const [channel, setChannel] = useState(demande.channel)
  const [source, setSource] = useState(demande.referral_source_id ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = channel !== demande.channel || source !== (demande.referral_source_id ?? '')
  useUnsavedChanges(dirty)
  // A source archived since still shows (and can be kept), by its name.
  const options =
    demande.referral_source_id && !referralSources.some((s) => s.id === demande.referral_source_id)
      ? [...referralSources, { id: demande.referral_source_id, name: heardName ?? t(`${S}.archivedSource`) }]
      : referralSources

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!dirty || pending) return
    setPending(true)
    setError(null)
    try {
      await onSave({ channel, referralSourceId: source || null })
      onClose()
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : t(`${S}.saveError`))
    } finally {
      setPending(false)
    }
  }

  return (
    <form aria-labelledby={`${id}-legend`} onSubmit={(event) => void submit(event)} noValidate className="space-y-3" aria-busy={pending || undefined}>
      <p id={`${id}-legend`} className="sr-only">
        {t(`${S}.editTitle`)}
      </p>
      <FormRow>
        <FormField label={t(`${S}.channel`)} width="sm">
          {(field) => (
            <Select {...field} value={channel} autoFocus onChange={(event) => setChannel(event.target.value)}>
              {SOURCE_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {channelLabel(c)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t(`${S}.heard`)} help={t(`${S}.heardQuestion`)}>
          {(field) => (
            <Select {...field} value={source} onChange={(event) => setSource(event.target.value)}>
              <option value="">{t(`${S}.notSaid`)}</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </FormRow>
      <p className="text-xs text-muted-foreground">{t(`${S}.capturedReadOnly`)}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <FormActions onCancel={onClose} dirty={dirty} pending={pending} cancelCloses />
      </div>
    </form>
  )
}

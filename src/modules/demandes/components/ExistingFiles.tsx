import { useId } from 'react'
import { Link } from 'react-router-dom'
import { CircleAlert, FolderCheck } from 'lucide-react'
import { t } from '@/i18n'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import type { IntakeMatch, IntakeMatches } from '../api/demandes'
import { clientNumber, demandePath, fileLabel } from '../lib/display'

const X = 'modules.demandes.new.matches'

/** The file the counselor chose, as the section remembers it (it may leave the matches). */
export interface ChosenFile {
  clientId: string
  label: string
}

/** « Même téléphone (…4567) · Même nom ». */
function matchedOnText(match: IntakeMatch): string {
  return match.matched_on
    .map((m) =>
      t(`${X}.matchedOn.${m}`, {
        hint: (m === 'phone' || m === 'partial_phone' ? match.phone_hint : match.email_hint) ?? '',
      }),
    )
    .join(' · ')
}

function OpenDemandeLine({ id, reference, contact = false }: { id: string; reference: string; contact?: boolean }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-foreground">
      <span>{t(contact ? `${X}.openContact` : `${X}.open`, { reference })}</span>
      {/* A new tab: what was typed stays in the dialog. */}
      <Link
        to={demandePath(id)}
        target="_blank"
        rel="noreferrer"
        aria-label={t(`${X}.openLinkFor`, { reference })}
        className="text-link underline-offset-2 hover:underline"
      >
        {t(`${X}.openLink`)}
      </Link>
    </p>
  )
}

/**
 * « Dossiers existants (N) » under the contact fields of « Nouvelle demande » (D-55): the files
 * Clients' rule finds for what is typed (number, name, birth year, what matched with a masked hint),
 * « Utiliser ce dossier » / « Ne pas rattacher », and a warning, never blocking, for a request
 * already open for the file or with the same contact. Nothing at all when nothing matched.
 * Only a short line is a live region, so a screen reader is not read the list at each keystroke.
 */
export function ExistingFiles({
  matches,
  loading,
  failed,
  chosen,
  onChoose,
}: {
  matches: IntakeMatches | null
  loading: boolean
  failed: boolean
  chosen: ChosenFile | null
  onChoose: (file: ChosenFile | null) => void
}) {
  const titleId = useId()
  const clients = matches?.clients ?? []
  const contactOpen = matches?.open_demandes ?? []
  const chosenListed = chosen !== null && clients.some((c) => c.client_id === chosen.clientId)
  const any = clients.length > 0 || contactOpen.length > 0

  return (
    <div className="space-y-2">
      <p role="status" aria-live="polite" className="sr-only">
        {any ? t(`${X}.announce`, { count: String(clients.length) }) : loading ? t(`${X}.searching`) : ''}
      </p>
      {loading && !any && (
        <p aria-hidden className="text-sm text-muted-foreground">
          {t(`${X}.searching`)}
        </p>
      )}
      {failed && !any && <p className="text-sm text-muted-foreground">{t(`${X}.failed`)}</p>}
      {chosen && !chosenListed && <ChosenLine chosen={chosen} onUnlink={() => onChoose(null)} />}
      {any && (
        <section aria-labelledby={titleId} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id={titleId} className="text-sm font-medium">
              {t(`${X}.title`, { count: String(clients.length) })}
            </h3>
            {loading && <span className="text-xs text-muted-foreground">{t(`${X}.searching`)}</span>}
          </div>
          {contactOpen.map((d) => (
            <Alert key={d.id} variant="warning">
              <CircleAlert aria-hidden />
              <AlertDescription>
                <OpenDemandeLine id={d.id} reference={d.reference} contact />
              </AlertDescription>
            </Alert>
          ))}
          {clients.length > 0 && (
            <ul className="divide-y divide-border-light">
              {clients.map((c) => {
                const isChosen = chosen?.clientId === c.client_id
                const label = fileLabel(c.client_number, c.display_name)
                return (
                  <li key={c.client_id} className="space-y-1.5 py-2 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                      <div className="min-w-0 text-sm">
                        <p className="font-medium">
                          <span className="tabular">{clientNumber(c.client_number)}</span> · {c.display_name}
                          {c.is_archived && (
                            <Badge variant="default" className="ml-2">
                              {t(`${X}.archived`)}
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[c.birth_year !== null ? t(`${X}.born`, { year: String(c.birth_year) }) : null, matchedOnText(c)].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {isChosen ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => onChoose(null)} className="max-sm:h-11">
                          {t(`${X}.unlink`)}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => onChoose({ clientId: c.client_id, label })}
                          aria-label={t(`${X}.useFor`, { file: label })}
                          className="max-sm:h-11"
                        >
                          {t(`${X}.use`)}
                        </Button>
                      )}
                    </div>
                    {isChosen && (
                      <p className="flex items-center gap-1.5 text-sm text-foreground">
                        <FolderCheck aria-hidden className="size-4 shrink-0 text-success" />
                        {t(`${X}.chosen`, { file: label })}
                      </p>
                    )}
                    {c.open_demandes.map((d) => (
                      <Alert key={d.id} variant="warning">
                        <CircleAlert aria-hidden />
                        <AlertDescription>
                          <OpenDemandeLine id={d.id} reference={d.reference} />
                        </AlertDescription>
                      </Alert>
                    ))}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

/** The chosen file when the matches no longer list it (the fields changed since). */
function ChosenLine({ chosen, onUnlink }: { chosen: ChosenFile; onUnlink: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
      <p className="flex items-center gap-1.5">
        <FolderCheck aria-hidden className="size-4 shrink-0 text-success" />
        {t(`${X}.chosen`, { file: chosen.label })}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onUnlink} className="max-sm:h-11">
        {t(`${X}.unlink`)}
      </Button>
    </div>
  )
}

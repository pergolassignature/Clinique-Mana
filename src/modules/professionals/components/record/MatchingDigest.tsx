import { useMemo, type ReactNode } from 'react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import type { ProfessionalRecord } from '../../api/parse'
import type { CatalogView } from '../../lib/catalog-view'
import { minClientAgeLabel, placesLabel } from '../../lib/display'
import { matchingDigest, type DigestItem, type MatchingDigest as Digest } from '../../lib/matching-digest'
import { MotifsSummary } from './MotifsSummary'
import { TabLink } from './TabLink'

const M = 'modules.professionals.record.overview.matching'

interface MatchingDigestProps {
  record: ProfessionalRecord
  catalog: CatalogView
  /** `professionals.matching`: « Modifier » opens Jumelage. */
  canEdit: boolean
}

/**
 * Aperçu « Profil de jumelage »: a read-only digest of what matching reads, the places offered
 * (« 4 places offertes · depuis le 8 oct. », P4-382) and the staff note « Bon à savoir » (P4-384);
 * edited in Jumelage.
 */
export function MatchingDigest({ record, catalog, canEdit }: MatchingDigestProps) {
  const digest = useMemo(() => matchingDigest(record, catalog), [record, catalog])
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>{t(`${M}.title`)}</CardTitle>
        {canEdit && (
          <Button asChild variant="outline" size="sm">
            <TabLink id={record.professional.id} tab="jumelage" unstyled>
              {t(`${M}.edit`)}
            </TabLink>
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border-light">
          <Row label={t(`${M}.clienteles`)}>
            <Items items={digest.clienteles} empty={t(`${M}.empty.clienteles`)} />
            <Limits digest={digest} />
          </Row>
          {/* Stacked at every width: the motifs take the card's whole width, every name written out (P4-249). */}
          <Row label={t(`${M}.motifs`)} stacked>
            {digest.motifs.groups.length === 0 ? <Empty>{t(`${M}.empty.motifs`)}</Empty> : <MotifsSummary summary={digest.motifs} />}
          </Row>
          <Row label={t(`${M}.languages`)}>
            <Items items={digest.languages} empty={t(`${M}.empty.languages`)} />
          </Row>
          <Row label={t(`${M}.availability`)}>{digest.periods || <Empty>{t(`${M}.empty.availability`)}</Empty>}</Row>
          <Row label={t(`${M}.accepting`)}>{t(digest.acceptingNewClients ? `${M}.yes` : `${M}.no`)}</Row>
          <Row label={t(`${M}.places`)}>
            {digest.newClientPlaces === null ? (
              <Empty>{placesLabel(null, null, Date.now())}</Empty>
            ) : (
              placesLabel(digest.newClientPlaces, digest.newClientPlacesSetAt, Date.now())
            )}
          </Row>
          {digest.note && <Row label={t(`${M}.note`)}>{digest.note}</Row>}
          {/* Staff only (P4-384): the record carries it for professionals.view, never for the provider. */}
          {digest.matchingNote && (
            <Row label={t(`${M}.matchingNote`)}>
              <span className="whitespace-pre-line">{digest.matchingNote}</span>
            </Row>
          )}
        </dl>
      </CardContent>
    </Card>
  )
}

/** Label above the value on phones, beside it from `sm` up (`stacked`: above it at every width). */
function Row({ label, stacked = false, children }: { label: string; stacked?: boolean; children: ReactNode }) {
  return (
    <div className={cn('grid gap-x-4 gap-y-0.5 py-2 first:pt-0 last:pb-0', stacked ? 'gap-y-1.5' : 'sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)]')}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

/** « Âge minimum : 14 ans » (when no held age group carries it) and « Femmes seulement », under the clientèles (P4-245). */
export function Limits({ digest }: { digest: Pick<Digest, 'minClientAge' | 'womenOnly'> }) {
  const lines = [digest.minClientAge !== null && minClientAgeLabel(digest.minClientAge), digest.womenOnly && t('modules.professionals.display.womenOnly')].filter(
    (line): line is string => typeof line === 'string',
  )
  return lines.length > 0 && <span className="mt-0.5 block text-foreground">{lines.join(' · ')}</span>
}

function Items({ items, empty }: { items: DigestItem[]; empty: string }) {
  return items.length === 0 ? <Empty>{empty}</Empty> : <Joined items={items} />
}

/** « ★ Couples · Enfants (0 à 12 ans) · Ancien motif (archivé) »: one line that wraps. */
function Joined({ items }: { items: DigestItem[] }) {
  return items.map((item, index) => (
    <span key={item.id}>
      {index > 0 && ' · '}
      {item.specialized && (
        <span aria-hidden className="text-warning">
          ★{' '}
        </span>
      )}
      {item.label}
      {item.specialized && <span className="sr-only"> {t(`${M}.specialized`)}</span>}
      {item.archived && <span className="text-muted-foreground"> ({t(`${M}.archived`)})</span>}
    </span>
  ))
}

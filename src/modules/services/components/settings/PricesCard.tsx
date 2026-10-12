import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SectionHeading } from '@/shared/components/SectionHeading'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { ServicesSettings } from '../../api/catalogue'
import type { ServicePrice } from '../../api/parse'
import { useServicePrices } from '../../hooks/use-services'
import { gridDurationLabel } from '../../lib/display'
import { formatCents } from '../../lib/format'
import { priceGaps } from '../../lib/price-gaps'

const R = 'modules.services.settings.prices'

interface PricesCardProps {
  data: ServicesSettings
}

/**
 * « Prix » (plan S3.2): read-only, the grid price of every active grid service for each
 * profession that offers it, today, with the student and reduced rates in force under it, and
 * « À confirmer » where the profession has no grid; then the gap report against GOrendezvous's
 * observed prices (plan §5.4). The grids themselves are Paramètres → Rémunération's.
 */
export function PricesCard({ data }: PricesCardProps) {
  const { services, titles, titleIdsByService } = data
  const today = useClinicDate()
  const prices = useServicePrices(today)
  const { can } = useAccess()
  const gridServices = services.filter((s) => s.isActive && s.priceSource === 'grid').sort((a, b) => a.code - b.code)
  const offering = titles.filter((title) => gridServices.some((s) => (titleIdsByService.get(s.id) ?? []).includes(title.id)))

  let content
  if (prices.data) {
    const rows = prices.data
    const priceOf = (serviceId: string, titleId: string) => rows.find((p) => p.serviceId === serviceId && p.titleId === titleId)
    const gaps = priceGaps(titles, services, rows)
    content = (
      <div className="space-y-5">
        {gridServices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`${R}.empty`)}</p>
        ) : (
          <Table aria-label={t(`${R}.table`)} scrollLabel={t(`${R}.table`)} scrollFocus="overflow" className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
            <TableHeader>
              <TableRow className="[&>th]:whitespace-nowrap">
                <TableHead>{t(`${R}.columns.title`)}</TableHead>
                {gridServices.map((service) => (
                  <TableHead key={service.id} align="right">
                    {service.code}
                    <span className="block normal-case tracking-normal">{service.gridDuration === null ? service.name : gridDurationLabel(service.gridDuration)}</span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {offering.map((title) => (
                <TableRow key={title.id} className="align-top">
                  <TableCell className="font-medium">{title.name}</TableCell>
                  {gridServices.map((service) => {
                    const offered = (titleIdsByService.get(service.id) ?? []).includes(title.id)
                    const price = offered ? priceOf(service.id, title.id) : undefined
                    return (
                      <TableCell key={service.id} align="right" className="whitespace-nowrap tabular">
                        {!offered ? <span className="text-muted-foreground">{t(`${R}.notOffered`)}</span> : <PriceCell price={price} />}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <section>
          <SectionHeading as="h3" description={t(`${R}.gaps.description`)}>
            {t(`${R}.gaps.title`)}
          </SectionHeading>
          {gaps.length === 0 ? (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {t(`${R}.gaps.none`)}
            </p>
          ) : (
            <Table aria-label={t(`${R}.gaps.title`)} className="mt-2 max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
              <TableHeader>
                <TableRow className="[&>th]:whitespace-nowrap">
                  <TableHead>{t(`${R}.gaps.columns.title`)}</TableHead>
                  <TableHead>{t(`${R}.gaps.columns.duration`)}</TableHead>
                  <TableHead align="right">{t(`${R}.gaps.columns.grid`)}</TableHead>
                  <TableHead align="right">{t(`${R}.gaps.columns.observed`)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gaps.map((gap) => (
                  <TableRow key={`${gap.title.id}-${gap.duration}`}>
                    <TableCell>{gap.title.name}</TableCell>
                    <TableCell className="whitespace-nowrap">{gridDurationLabel(gap.duration)}</TableCell>
                    <TableCell align="right" className="whitespace-nowrap tabular">
                      {gap.gridCents === null ? <span className="text-muted-foreground">{t(`${R}.gaps.missing`)}</span> : formatCents(gap.gridCents)}
                    </TableCell>
                    <TableCell align="right" className="whitespace-nowrap tabular">
                      {formatCents(gap.observedCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </div>
    )
  } else if (prices.isError) {
    content = <LoadError message={t('modules.services.settings.loadError')} retrying={prices.isFetching} onRetry={() => void prices.refetch()} />
  } else {
    content = <Loading />
  }

  return (
    <SettingsCard
      as="section"
      title={t(`${R}.title`)}
      description={t(`${R}.description`)}
      footer={
        can('professionals.compensation') ? (
          <GuardedNavLink to="/parametres/remuneration" className="text-sm text-link underline-offset-2 hover:underline">
            {t(`${R}.compensationLink`)}
          </GuardedNavLink>
        ) : undefined
      }
    >
      {content}
    </SettingsCard>
  )
}

/** The price, with the student and reduced rates under it; « À confirmer » without a grid. */
function PriceCell({ price }: { price: ServicePrice | undefined }) {
  if (!price || price.priceCents === null) return <span className="text-muted-foreground">{t(`${R}.toConfirm`)}</span>
  return (
    <>
      {formatCents(price.priceCents)}
      {price.studentPriceCents !== null && <span className="block text-xs text-muted-foreground">{t(`${R}.student`, { price: formatCents(price.studentPriceCents) })}</span>}
      {price.reducedPriceCents !== null && <span className="block text-xs text-muted-foreground">{t(`${R}.reduced`, { price: formatCents(price.reducedPriceCents) })}</span>}
    </>
  )
}

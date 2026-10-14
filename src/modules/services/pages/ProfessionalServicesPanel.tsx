import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { t } from '@/i18n'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { fetchOfferedServices } from '../api/offered'
import { serviceKeys } from '../hooks/keys'
import { durationLabel, priceSourceLabel, taxRuleLabel } from '../lib/display'
import { formatCents } from '../lib/format'
import type { OfferedService } from '../lib/offered'

const O = 'modules.services.offered'

/** Her price today in words: the amount, « Gratuit », « Saisi à la facture » or « À confirmer » (no grid in force). */
function priceText(s: OfferedService): string {
  if (s.priceSource === 'free') return priceSourceLabel('free')
  if (s.priceSource === 'entered') return priceSourceLabel('entered')
  return s.priceCents === null ? t(`${O}.toConfirm`) : formatCents(s.priceCents)
}

/**
 * « Services offerts » (L26, read-only) on a professional's record (slot `professional.services`,
 * tab « Jumelage »): the services her title(s) allow, by code, each with its duration (and pause)
 * and her price today (her primary title's grid, or the fixed price). Exclusions per professional
 * wait on Christine (question 62): the catalogue decides by title alone.
 */
export function ProfessionalServicesPanel() {
  const { id = '' } = useParams()
  const today = useClinicDate()
  const offered = useQuery({ queryKey: serviceKeys.offered(id, today), queryFn: () => fetchOfferedServices(id, today), enabled: id !== '' })

  let content
  if (offered.isError && !offered.data) content = <LoadError message={t(`${O}.loadError`)} onRetry={() => void offered.refetch()} retrying={offered.isFetching} />
  else if (offered.data === undefined) content = <Loading />
  else if (offered.data === null || offered.data.length === 0) content = <p className="text-sm text-muted-foreground">{t(`${O}.empty`)}</p>
  else {
    content = (
      <Table aria-label={t(`${O}.title`)} className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
        <TableHeader>
          <TableRow className="[&>th]:whitespace-nowrap">
            <TableHead>{t(`${O}.columns.service`)}</TableHead>
            <TableHead className="max-sm:hidden">{t(`${O}.columns.duration`)}</TableHead>
            <TableHead align="right">{t(`${O}.columns.price`)}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {offered.data.map((s) => (
            <TableRow key={s.id}>
              <TableCell>
                <span className="tabular text-muted-foreground">{s.code}</span> {s.name}
                {s.forTwo && <span className="block text-xs text-muted-foreground">{t(`${O}.forTwo`)}</span>}
                <span className="block text-xs text-muted-foreground sm:hidden">{durationLabel(s)}</span>
              </TableCell>
              <TableCell className="whitespace-nowrap max-sm:hidden">{durationLabel(s)}</TableCell>
              <TableCell align="right" className="whitespace-nowrap tabular">
                {priceText(s)}
                <span className="block text-xs text-muted-foreground">{taxRuleLabel(s.taxRule)}</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }
  return (
    <SettingsCard as="section" title={t(`${O}.title`)} description={t(`${O}.description`)}>
      {content}
    </SettingsCard>
  )
}

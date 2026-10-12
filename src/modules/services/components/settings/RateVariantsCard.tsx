import { useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { Button } from '@/shared/ui/button'
import { Table, TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import type { ServicesSettings } from '../../api/catalogue'
import type { RateVariantRow } from '../../api/parse'
import { useEndRateVariant } from '../../hooks/use-services'
import { canDeleteDated, datedStatus, lastDay, rowsOf } from '../../lib/dated'
import { discountLabel, variantLabel } from '../../lib/display'
import { ConfirmDeleteDialog, DatedStatusBadge } from './DatedParts'
import { EndVariantDialog, VariantDialog } from './VariantDialogs'

const V = 'modules.services.settings.variants'

/** Phone: 8 px cells, none at the edges. */
const PHONE_TABLE = 'max-sm:[&_td]:px-2 max-sm:[&_th]:px-2 max-sm:[&_td:first-child]:pl-0 max-sm:[&_th:first-child]:pl-0 max-sm:[&_td:last-child]:pr-0 max-sm:[&_th:last-child]:pr-0'

interface RateVariantsCardProps {
  data: ServicesSettings
  canEdit: boolean
}

/**
 * « Tarifs étudiant et réduit » (R-5): the dated variants grouped by service, newest first, with
 * their profession (or every one), the discount, the period and the status; « Nouveau tarif »;
 * « Terminer » on a rate in force, « Supprimer » on one the database will let go (not in force
 * yet, or created less than 24 hours ago).
 */
export function RateVariantsCard({ data, canEdit }: RateVariantsCardProps) {
  const { services, titles, variants } = data
  const today = useClinicDate()
  const now = Date.now()
  const [toEnd, setToEnd] = useState<RateVariantRow | null>(null)
  const [endOpen, setEndOpen] = useState(false)
  const [toDelete, setToDelete] = useState<RateVariantRow | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const remove = useEndRateVariant({ onErrorMessage: (message) => setRefusal(message) })
  const trigger = useRef<HTMLButtonElement | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)

  const serviceOf = (row: RateVariantRow) => services.find((s) => s.id === row.serviceId)
  const titleName = (id: string | null) => (id === null ? t(`${V}.allTitles`) : (titles.find((title) => title.id === id)?.name ?? t(`${V}.archivedTitle`)))
  const seriesOf = (row: RateVariantRow) => rowsOf(variants, (other) => other.serviceId === row.serviceId && other.variant === row.variant && other.titleId === row.titleId)
  // One group per service holding rates, in the catalogue's order.
  const groups = services.filter((s) => variants.some((row) => row.serviceId === s.id)).map((s) => ({ service: s, rows: rowsOf(variants, (row) => row.serviceId === s.id) }))
  const priceable = services.filter((s) => s.isActive && (s.priceSource === 'grid' || s.priceSource === 'fixed'))
  const columns = canEdit ? 7 : 6

  return (
    <SettingsCard
      as="section"
      title={t(`${V}.title`)}
      description={t(`${V}.description`)}
      footer={canEdit ? <VariantDialog ref={addRef} services={priceable} titles={titles} variants={variants} /> : undefined}
    >
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${V}.empty`)}</p>
      ) : (
        <Table aria-label={t(`${V}.title`)} className={PHONE_TABLE}>
          <TableHeader>
            <TableRow className="[&>th]:whitespace-nowrap">
              <TableHead>{t(`${V}.columns.variant`)}</TableHead>
              <TableHead>{t(`${V}.columns.title`)}</TableHead>
              <TableHead align="right">{t(`${V}.columns.discount`)}</TableHead>
              <TableHead>{t(`${V}.columns.from`)}</TableHead>
              <TableHead className="max-sm:hidden">{t(`${V}.columns.to`)}</TableHead>
              <TableHead>{t(`${V}.columns.status`)}</TableHead>
              {canEdit && (
                <TableHead>
                  <span className="sr-only">{t(`${V}.columns.actions`)}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          {groups.map(({ service, rows }) => (
            <TableBody key={service.id}>
              <TableGroupRow colSpan={columns}>
                {service.code} · {service.name}
              </TableGroupRow>
              {rows.map((row) => {
                const end = lastDay(row.effectiveTo)
                const status = datedStatus(row, today)
                const deletable = canDeleteDated(row, seriesOf(row), today, now, { keepFirst: false })
                return (
                  <TableRow key={row.id} className="align-top">
                    <TableCell className="whitespace-nowrap">{variantLabel(row.variant)}</TableCell>
                    <TableCell>{titleName(row.titleId)}</TableCell>
                    <TableCell align="right" className="whitespace-nowrap tabular">
                      {discountLabel(row)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDateOnlyShort(row.effectiveFrom)}
                      {end !== null && <span className="block text-xs text-muted-foreground sm:hidden">{t('modules.services.dated.until', { date: formatDateOnlyShort(end) })}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap max-sm:hidden">{end === null ? t(`${V}.noEnd`) : formatDateOnlyShort(end)}</TableCell>
                    <TableCell>
                      <DatedStatusBadge status={status} />
                    </TableCell>
                    {canEdit && (
                      <TableCell className="whitespace-nowrap py-1 text-right">
                        {row.effectiveTo === null && !deletable && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={t(`${V}.endLabel`, { variant: variantLabel(row.variant), service: service.name })}
                            onClick={(event) => {
                              trigger.current = event.currentTarget
                              setToEnd(row)
                              setEndOpen(true)
                            }}
                          >
                            {t(`${V}.end`)}
                          </Button>
                        )}
                        {deletable && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={t(`${V}.deleteLabel`, { variant: variantLabel(row.variant), service: service.name, date: formatDateOnlyShort(row.effectiveFrom) })}
                            onClick={(event) => {
                              trigger.current = event.currentTarget
                              setRefusal(null)
                              setToDelete(row)
                            }}
                          >
                            <Trash2 aria-hidden className="sm:hidden" />
                            <span className="max-sm:sr-only">{t(`${V}.delete`)}</span>
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          ))}
        </Table>
      )}
      <EndVariantDialog row={toEnd} serviceName={toEnd ? (serviceOf(toEnd)?.name ?? '') : ''} open={endOpen} onOpenChange={setEndOpen} triggerRef={trigger} fallbackRef={addRef} />
      <ConfirmDeleteDialog
        open={toDelete !== null}
        title={t(`${V}.deleteTitle`)}
        body={toDelete ? t(`${V}.deleteBody`, { variant: variantLabel(toDelete.variant), service: serviceOf(toDelete)?.name ?? '', date: formatDateOnlyShort(toDelete.effectiveFrom) }) : ''}
        pending={remove.isPending}
        refusal={refusal}
        onConfirm={() => {
          if (!toDelete) return
          setRefusal(null)
          remove.mutate({ id: toDelete.id, effectiveTo: null }, { onSuccess: () => setToDelete(null) })
        }}
        onOpenChange={(next) => {
          if (next) return
          remove.reset()
          setToDelete(null)
        }}
        triggerRef={trigger}
        fallbackRef={addRef}
      />
    </SettingsCard>
  )
}

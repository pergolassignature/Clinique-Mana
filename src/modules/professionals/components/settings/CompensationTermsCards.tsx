import { useRef } from 'react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import type { CompensationKind, RateRow } from '../../api/compensation'
import { useDeleteCompensationRate } from '../../hooks/use-compensation'
import { canDeleteDated, formatPercent, rowsOf } from '../../lib/compensation'
import { useToday } from '../compensation/use-today'
import { DatedTermsTable } from './DatedTermsTable'
import { RateDialog } from './RateDialog'

const O = 'modules.professionals.settings.compensation.rates'

/**
 * « Autres services » (P4-181, Jonathan): the clinic's retention on workshops and conferences,
 * late cancellations and other fees, the same for every professional, dated; « Nouveau taux »,
 * and « Supprimer » on the open rate while the database allows it (never a kind's first).
 */
export function OtherRatesCard({ kinds, rows }: { kinds: readonly CompensationKind[]; rows: readonly RateRow[] }) {
  const { now, today } = useToday()
  const addButton = useRef<HTMLButtonElement>(null)
  const kindName = (key: string) => kinds.find((kind) => kind.key === key)?.name ?? key
  const ofKind = (kind: string) => rowsOf(rows, (row) => row.kind === kind)
  const groups = kinds.map((kind) => ({ key: kind.key, name: kind.name, rows: ofKind(kind.key) })).filter((group) => group.rows.length > 0)
  const describe = (row: RateRow) => ({ kind: kindName(row.kind), rate: formatPercent(row.pct), date: formatDateOnlyShort(row.effectiveFrom) })

  return (
    <SettingsCard as="section" title={t(`${O}.title`)} description={t(`${O}.description`)} footer={<RateDialog ref={addButton} kinds={kinds} rows={rows} />}>
      {groups.length === 0 ? (
        <EmptyState title={t(`${O}.empty`)} />
      ) : (
        <DatedTermsTable
          label={t(`${O}.title`)}
          headers={{ value: t(`${O}.rate`), from: t(`${O}.from`), to: t(`${O}.to`), status: t(`${O}.status`), actions: t(`${O}.actions`) }}
          groups={groups}
          renderValue={(row) => <span className="whitespace-nowrap font-medium tabular">{formatPercent(row.pct)}</span>}
          deletable={(row) => canDeleteDated(row, ofKind(row.kind), today, now, { keepFirst: true })}
          deleteLabel={(row) => t(`${O}.deleteLabel`, describe(row))}
          confirm={(row) => ({ title: t(`${O}.deleteTitle`), body: t(`${O}.deleteBody`, describe(row)) })}
          useDelete={useDeleteCompensationRate}
          today={today}
          fallbackRef={addButton}
        />
      )}
    </SettingsCard>
  )
}

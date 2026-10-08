import { useRef } from 'react'
import { Info } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnlyShort, getClinicDateString } from '@/shared/lib/timezone'
import { useNow } from '@/shared/lib/use-now'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import type { CompensationKind, DefaultRangeRow, RecognitionRuleRow } from '../../api/compensation'
import { useDeleteCompensationDefault, useDeleteRecognitionRule } from '../../hooks/use-compensation'
import { canDeleteDated, formatCents, formatPercent, rangeLabel, rowsOfKind } from '../../lib/compensation'
import { DatedTermsTable } from './DatedTermsTable'
import { DefaultRangeDialog } from './DefaultRangeDialog'
import { RuleDialog } from './RuleDialog'

const D = 'modules.professionals.settings.compensation.defaults'
const R = 'modules.professionals.settings.compensation.rules'

/** The clinic's date, following the clock (midnight, the 24-hour correction window). */
function useToday() {
  const now = useNow(60_000)
  return { now, today: getClinicDateString(new Date(now)) }
}

/**
 * « Marges par défaut »: per kind, its dated ranges (the one a professional without a margin of
 * their own gets), « Nouvelle fourchette », and « Supprimer » on the open range while the
 * database allows it (never a kind's first range, P4-145).
 */
export function DefaultRangesCard({ kinds, rows }: { kinds: readonly CompensationKind[]; rows: readonly DefaultRangeRow[] }) {
  const { now, today } = useToday()
  const addButton = useRef<HTMLButtonElement>(null)
  const kindName = (key: string) => kinds.find((kind) => kind.key === key)?.name ?? key
  const groups = kinds.map((kind) => ({ key: kind.key, name: kind.name, rows: rowsOfKind(rows, kind.key) })).filter((group) => group.rows.length > 0)
  const describe = (row: DefaultRangeRow) => ({ kind: kindName(row.kind), range: rangeLabel(row.min, row.max), date: formatDateOnlyShort(row.effectiveFrom) })

  return (
    <SettingsCard
      as="section"
      title={t(`${D}.title`)}
      description={t(`${D}.description`)}
      footer={<DefaultRangeDialog ref={addButton} kinds={kinds} rows={rows} />}
    >
      {groups.length === 0 ? (
        <EmptyState title={t(`${D}.empty`)} />
      ) : (
        <DatedTermsTable
          label={t(`${D}.title`)}
          headers={{ value: t(`${D}.range`), from: t(`${D}.from`), to: t(`${D}.to`), status: t(`${D}.status`), actions: t(`${D}.actions`) }}
          groups={groups}
          renderValue={(row) => <span className="whitespace-nowrap font-medium tabular">{rangeLabel(row.min, row.max)}</span>}
          deletable={(row) => canDeleteDated(row, rowsOfKind(rows, row.kind), today, now, { keepFirst: true })}
          deleteLabel={(row) => t(`${D}.deleteLabel`, describe(row))}
          confirm={(row) => ({ title: t(`${D}.deleteTitle`), body: t(`${D}.deleteBody`, describe(row)) })}
          useDelete={useDeleteCompensationDefault}
          today={today}
          fallbackRef={addButton}
        />
      )}
    </SettingsCard>
  )
}

/**
 * « Programme de reconnaissance »: the dated rules as the contract gives them (no amount is
 * computed, P4-8), « Nouvelle règle », « Supprimer » on the open rule while allowed (never the
 * first one).
 */
export function RecognitionRulesCard({ rows }: { rows: readonly RecognitionRuleRow[] }) {
  const { now, today } = useToday()
  const addButton = useRef<HTMLButtonElement>(null)
  const sorted = [...rows].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
  const open = sorted.find((row) => row.effectiveTo === null)

  return (
    <SettingsCard as="section" title={t(`${R}.title`)} description={t(`${R}.description`)} footer={<RuleDialog ref={addButton} rows={sorted} />}>
      {open?.capBasis === 'unconfirmed' && (
        <Alert>
          <Info aria-hidden />
          <AlertDescription className="text-foreground">
            {t('modules.professionals.record.compensation.recognition.capUnconfirmed', { cap: formatPercent(open.capPct) })}
          </AlertDescription>
        </Alert>
      )}
      {sorted.length === 0 ? (
        <EmptyState title={t(`${R}.empty`)} />
      ) : (
        <DatedTermsTable
          label={t(`${R}.title`)}
          headers={{ value: t(`${R}.rule`), from: t(`${R}.from`), to: t(`${D}.to`), status: t(`${R}.status`), actions: t(`${R}.actions`) }}
          groups={[{ key: 'rules', name: null, rows: sorted }]}
          renderValue={(row) => (
            <>
              <span className="block">
                {t(`${R}.summary`, {
                  step: String(row.stepSessions),
                  bonus50: formatCents(row.bonusPer50MinCents),
                  bonus30: formatCents(row.bonusPer30MinCents),
                })}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t(`${R}.cap`, { cap: formatPercent(row.capPct), basis: t(`${R}.bases.${row.capBasis}`) })}
              </span>
              {row.note && <span className="block break-words text-xs text-muted-foreground">{row.note}</span>}
            </>
          )}
          deletable={(row) => canDeleteDated(row, sorted, today, now, { keepFirst: true })}
          deleteLabel={(row) => t(`${R}.deleteLabel`, { date: formatDateOnlyShort(row.effectiveFrom) })}
          confirm={(row) => ({ title: t(`${R}.deleteTitle`), body: t(`${R}.deleteBody`, { date: formatDateOnlyShort(row.effectiveFrom) }) })}
          useDelete={useDeleteRecognitionRule}
          today={today}
          fallbackRef={addButton}
        />
      )}
    </SettingsCard>
  )
}

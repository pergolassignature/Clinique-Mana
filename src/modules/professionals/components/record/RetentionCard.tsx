import { useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatDateOnlyShort, getClinicDateString } from '@/shared/lib/timezone'
import { useNow } from '@/shared/lib/use-now'
import { Button } from '@/shared/ui/button'
import type { Decision, ProfessionalCompensation, RetentionRow } from '../../api/compensation'
import { useDeleteRetention } from '../../hooks/use-compensation'
import {
  canDeleteDated,
  datedStatus,
  earliestStart,
  formatPercent,
  formatSessions,
  monthCount,
  monthLabel,
  monthOf,
  periodLabel,
  sessionsLabel,
  shiftMonth,
  tierRangeLabel,
  withRunningTotals,
} from '../../lib/compensation'
import { ConfirmDeleteDialog, DatedStatusBadge } from '../compensation/DatedRowParts'
import { DecisionDialog, type DecisionTarget } from '../compensation/DecisionDialog'
import { Item, PayList, RetentionStatusBadge } from '../compensation/RetentionParts'
import { AgreementsSection } from './AgreementsSection'
import { Disclosure } from './MotifsSummary'
import { SessionsDialog } from './SessionsDialog'

const R = 'modules.professionals.record.compensation.retention'
const W = 'modules.professionals.compensation'

interface RetentionCardProps {
  professionalId: string
  data: ProfessionalCompensation
}

/** The decisions offered for the current state (P4-187): the database checks them again. */
function decisionsFor(data: ProfessionalCompensation): Decision[] {
  const out: Decision[] = []
  if (data.rateRows.length === 0) out.push('initial')
  if (data.suggested && (data.applied === null || data.applied.pct !== data.suggested.pct || data.applied.decision === 'custom')) out.push('suggested')
  if (data.suggested && data.applied && data.status === 'gap') out.push('maintained')
  if (data.rateRows.length > 0) out.push('custom')
  return out
}

/**
 * « Rétention » (`professionals.compensation`, P4-180…): the professional's cumulative sessions
 * (« Ajouter les séances du mois »), the applied rate and how it was decided, the grid's
 * suggestion and next tier, the status, the pay per duration, the decisions, the client
 * agreements, the clinic's other rates, and the histories of rates and months. The retention is
 * internal: nothing here is ever shown to the professional.
 */
export function RetentionCard({ professionalId, data }: RetentionCardProps) {
  const now = useNow(60_000)
  const today = getClinicDateString(new Date(now))
  const [decision, setDecision] = useState<DecisionTarget | null>(null)
  const [toDelete, setToDelete] = useState<RetentionRow | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const remove = useDeleteRetention(professionalId, { onErrorMessage: (message) => setRefusal(message) })
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)
  const sessionsButton = useRef<HTMLButtonElement>(null)
  const { applied, suggested } = data
  const upcoming = applied && applied.effectiveFrom > today
  const months = withRunningTotals(data.sessionRows)

  const openDecision = (kind: Decision) =>
    setDecision({
      professionalId,
      name: null,
      decision: kind,
      appliedPct: applied?.pct ?? null,
      appliedDecision: applied?.decision ?? null,
      suggestedPct: suggested?.pct ?? null,
      tierLabel: suggested ? tierRangeLabel(suggested.threshold, data.next?.threshold ?? null) : null,
      minDate: earliestStart(data.rateRows),
      defaultFrom: shiftMonth(monthOf(today), 1),
      // The record's count runs through the current month (P4-194), as shown.
      countMonth: monthOf(data.on),
      expectedOpenId: applied?.id ?? null,
    })

  return (
    <SettingsCard as="section" title={t(`${R}.title`)} description={t(`${R}.description`)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <RetentionStatusBadge status={data.status} />
        {data.title && <span className="text-xs text-muted-foreground">{t(`${R}.grid`, { title: data.title.name })}</span>}
      </div>
      {data.status === 'profession_unconfirmed' && <p className="text-sm text-muted-foreground">{t(`${R}.noGrid`)}</p>}

      <dl className="grid gap-3 sm:grid-cols-3">
        <Item term={t(`${R}.sessions`)}>
          <span className="tabular">{formatSessions(data.sessionsTotal)}</span>
        </Item>
        <Item term={t(`${R}.applied`)}>
          {applied ? (
            <>
              <span className="tabular">{formatPercent(applied.pct)}</span>{' '}
              <span className="text-xs text-muted-foreground">{t(`${W}.decisions.${applied.decision}`)}</span>
              <span className="block text-xs text-muted-foreground">
                {upcoming
                  ? t(`${R}.upcoming`, { date: formatDateOnlyShort(applied.effectiveFrom), rate: data.inForcePct === null ? '—' : formatPercent(data.inForcePct) })
                  : t(`${R}.since`, { date: formatDateOnlyShort(applied.effectiveFrom) })}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{t(`${R}.noRate`)}</span>
          )}
        </Item>
        <Item term={t(`${R}.suggested`)}>
          {suggested ? (
            <>
              <span className="tabular">{formatPercent(suggested.pct)}</span>
              <span className="block text-xs text-muted-foreground">
                {t(`${R}.tier`, { range: tierRangeLabel(suggested.threshold, data.next?.threshold ?? null) })}
                {' · '}
                {data.next ? t(`${R}.next`, { tier: sessionsLabel(data.next.threshold), rate: formatPercent(data.next.pct) }) : t(`${R}.maxTier`)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Item>
      </dl>

      <div className="flex flex-wrap gap-2">
        <SessionsDialog ref={sessionsButton} professionalId={professionalId} rows={data.sessionRows} total={data.sessionsTotal} />
        {data.grid &&
          decisionsFor(data).map((kind) => (
            <Button key={kind} type="button" variant={kind === 'suggested' && data.status === 'gap' ? 'default' : 'outline'} size="sm" onClick={() => openDecision(kind)}>
              {t(`${W}.decision.action.${kind}`)}
            </Button>
          ))}
      </div>

      {data.pay.length > 0 && (
        <div>
          <h4 className="text-xs text-muted-foreground">{t(`${R}.pay`)}</h4>
          <div className="mt-1">
            <PayList pay={data.pay} upcomingFrom={upcoming ? applied.effectiveFrom : null} />
          </div>
        </div>
      )}

      <AgreementsSection professionalId={professionalId} rows={data.agreementRows} today={today} now={now} />

      {data.otherRates.some((rate) => rate.pct !== null) && (
        <p className="text-xs text-muted-foreground">
          {t(`${R}.otherRates`, {
            rates: data.otherRates
              .filter((rate) => rate.pct !== null)
              .map((rate) => `${rate.name} ${formatPercent(rate.pct ?? 0)}`)
              .join(' · '),
          })}
        </p>
      )}

      {data.rateRows.length > 0 && (
        <Disclosure label={<span className="text-sm">{t(`${R}.rateHistory`)}</span>}>
          <ol className="divide-y divide-border-light rounded-md border border-border-light">
            {data.rateRows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="font-medium tabular">{formatPercent(row.pct)}</span>
                <span>{t(`${W}.decisions.${row.decision}`)}</span>
                <span className="text-muted-foreground">{periodLabel(row)}</span>
                <DatedStatusBadge status={datedStatus(row, today)} />
                {row.sessionsTotal !== null && (
                  <span className="basis-full text-xs text-muted-foreground">
                    {row.suggestedPct === null
                      ? t(`${R}.snapshotNoGrid`, { sessions: sessionsLabel(row.sessionsTotal) })
                      : t(`${R}.snapshot`, { sessions: sessionsLabel(row.sessionsTotal), rate: formatPercent(row.suggestedPct) })}
                  </span>
                )}
                {row.note && <span className="basis-full break-words text-xs text-muted-foreground">{row.note}</span>}
                {canDeleteDated(row, data.rateRows, today, now, { keepFirst: false }) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    aria-label={t(`${R}.deleteLabel`, { rate: formatPercent(row.pct), date: formatDateOnlyShort(row.effectiveFrom) })}
                    onClick={(event) => {
                      deleteTrigger.current = event.currentTarget
                      setRefusal(null)
                      setToDelete(row)
                    }}
                  >
                    <Trash2 aria-hidden className="sm:hidden" />
                    <span className="max-sm:sr-only">{t(`${W}.delete`)}</span>
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </Disclosure>
      )}

      {months.length > 0 && (
        <Disclosure label={<span className="text-sm">{t(`${R}.monthHistory`)}</span>}>
          <ol className="divide-y divide-border-light rounded-md border border-border-light">
            {months.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                <span className="font-medium first-letter:uppercase">{monthLabel(row.month)}</span>
                {(row.long !== 0 || row.short !== 0) && (
                  <span className="text-muted-foreground">{t(`${R}.monthRow`, { long: String(row.long), short: String(row.short) })}</span>
                )}
                {row.adjustment !== 0 && (
                  <span className="text-muted-foreground">{t(`${R}.adjustment`, { value: `${row.adjustment > 0 ? '+' : ''}${formatSessions(row.adjustment)}` })}</span>
                )}
                <span className="ml-auto tabular">
                  {t(`${R}.monthTotal`, { count: formatSessions(monthCount(row.long, row.short, row.adjustment)), total: formatSessions(row.total) })}
                </span>
                {row.note && <span className="basis-full break-words text-xs text-muted-foreground">{row.note}</span>}
              </li>
            ))}
          </ol>
        </Disclosure>
      )}

      <DecisionDialog target={decision} onClose={() => setDecision(null)} />
      <ConfirmDeleteDialog
        open={toDelete !== null}
        title={t(`${R}.deleteTitle`)}
        body={toDelete ? t(`${R}.deleteBody`, { rate: formatPercent(toDelete.pct), date: formatDateOnlyShort(toDelete.effectiveFrom) }) : ''}
        pending={remove.isPending}
        refusal={refusal}
        onConfirm={() => {
          if (!toDelete) return
          setRefusal(null)
          remove.mutate(toDelete.id, { onSuccess: () => setToDelete(null) })
        }}
        onOpenChange={(next) => {
          if (next) return
          remove.reset()
          setToDelete(null)
        }}
        triggerRef={deleteTrigger}
        fallbackRef={sessionsButton}
      />
    </SettingsCard>
  )
}

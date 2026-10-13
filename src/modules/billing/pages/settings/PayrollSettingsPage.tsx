import { useState } from 'react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { ScheduledJobState } from '@/core/jobs/components/ScheduledJobState'
import { useSettingsSection } from '@/core/settings/section-context'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { SectionSurface, SettingsCard } from '@/shared/components/SettingsCard'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import { Table, TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { PAYOUT_RULES, type PayoutRule, type PayoutRuleRow } from '../../api/payroll'
import { payrollErrorMessage } from '../../api/payroll-errors'
import { usePayoutRules, useSetPayoutRule } from '../../hooks/use-payroll'
import { ruleLabel } from '../../lib/payroll'

const S = 'modules.billing.payroll.settings'
const JOB = 'billing.payout_periods'

/**
 * Paramètres → Paie (seen with `billing.settings` or `billing.payroll`, changed with
 * `billing.settings`): how each service is paid to the professional — at the grid (« Rencontre »),
 * at the « Annulation tardive », « Autres frais » or « Ateliers » rate, or not at all. Each rule is
 * saved as it is chosen. The rates themselves are Professionnels' (Paramètres → Rémunération); the
 * job builds last month's summaries on the 1st.
 */
export function PayrollSettingsPage() {
  const { readOnly } = useSettingsSection()
  const { can } = useAccess()
  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${S}.title`)} description={t(`${S}.description`)} />
      {readOnly && <ReadOnlyNotice />}
      <SectionSurface>
        <RulesCard readOnly={readOnly} />
        <SettingsCard as="section" layout="section" title={t(`${S}.job.title`)} description={t(`${S}.job.description`)}>
          {can('settings.view') ? (
            <ScheduledJobState jobKey={JOB} texts={`${S}.job.state`} />
          ) : (
            <p className="text-sm text-muted-foreground">{t(`${S}.job.unknown`)}</p>
          )}
        </SettingsCard>
      </SectionSurface>
    </div>
  )
}

function RulesCard({ readOnly }: { readOnly: boolean }) {
  const rules = usePayoutRules()
  const set = useSetPayoutRule()
  const [error, setError] = useState<string | null>(null)

  const change = (row: PayoutRuleRow, rule: PayoutRule) => {
    setError(null)
    set.mutateAsync({ serviceId: row.service_id, rule }).then(
      () => toast.success(t(`${S}.rules.saved`, { service: `${row.code} ${row.name}`, rule: ruleLabel(rule) })),
      (failure: unknown) => setError(payrollErrorMessage(failure)),
    )
  }

  let content
  if (rules.isPending) content = <Loading />
  else if (rules.isError && !rules.data) {
    content = <LoadError message={t(`${S}.rules.loadError`)} retrying={rules.isFetching} onRetry={() => void rules.refetch()} />
  } else {
    const families = [...new Map(rules.data.map((r) => [r.family_code, r.family_name])).entries()]
    content = (
      <div className="space-y-3">
        {error && <RefusalAlert message={error} />}
        <Table aria-label={t(`${S}.rules.table`)} scrollLabel={t(`${S}.rules.table`)} scrollFocus="overflow">
          <TableHeader>
            <TableRow>
              <TableHead>{t(`${S}.rules.columns.service`)}</TableHead>
              <TableHead>{t(`${S}.rules.columns.rule`)}</TableHead>
            </TableRow>
          </TableHeader>
          {families.map(([code, name]) => (
            <FamilyRows key={code} name={name} rows={rules.data.filter((r) => r.family_code === code)} readOnly={readOnly} busy={set.isPending} onChange={change} />
          ))}
        </Table>
      </div>
    )
  }
  return (
    <SettingsCard as="section" layout="section" title={t(`${S}.rules.title`)} description={t(`${S}.rules.description`)}>
      {content}
    </SettingsCard>
  )
}

function FamilyRows({ name, rows, readOnly, busy, onChange }: {
  name: string
  rows: readonly PayoutRuleRow[]
  readOnly: boolean
  busy: boolean
  onChange: (row: PayoutRuleRow, rule: PayoutRule) => void
}) {
  return (
    <TableBody>
      <TableGroupRow colSpan={2}>{name}</TableGroupRow>
      {rows.map((row) => (
        <TableRow key={row.service_id}>
          <TableCell>
            <span className="tabular">{row.code}</span> {row.name}
            {!row.is_active && <span className="block text-xs text-muted-foreground">{t(`${S}.rules.inactive`)}</span>}
          </TableCell>
          <TableCell className="min-w-[14rem]">
            <Select
              aria-label={t(`${S}.rules.selectLabel`, { service: `${row.code} ${row.name}` })}
              value={row.rule}
              readOnly={readOnly}
              aria-disabled={busy || undefined}
              onChange={(event) => !busy && onChange(row, event.target.value as PayoutRule)}
            >
              {PAYOUT_RULES.map((rule) => (
                <option key={rule} value={rule}>
                  {ruleLabel(rule)}
                </option>
              ))}
            </Select>
            {!row.is_default && <span className="mt-1 block text-xs text-muted-foreground">{t(`${S}.rules.changed`)}</span>}
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  )
}

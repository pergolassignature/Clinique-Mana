import { t } from '@/i18n'
import { buildCsv, csvNumber, type CsvCell } from '@/shared/lib/csv'
import { getClinicDateString } from '@/shared/lib/timezone'
import type { WaitlistEntry } from '../api/waitlist'
import { personLabel } from './display'
import { consentLabel, entryStateLabel, exitReasonLabel, feeLabel } from './waitlist'

const W = 'modules.demandes.waitlist'
const C = `${W}.page.csv`

/** « 12 » → « CLI-000012 » (Clients' file number, as the record shows it). */
const fileNumber = (n: number | null): string | null => (n === null ? null : `CLI-${String(n).padStart(6, '0')}`)

/**
 * The waiting list as a CSV (parity audit L7): the entries the page shows (one list or all, the
 * state filter), in its order, with their rank, wait, state, consent and fee. Never a free text
 * (the priority's reason, notes): those stay in the app.
 */
export function waitlistCsv(rows: readonly WaitlistEntry[], today: string): { fileName: string; content: string } {
  const header = [
    t(`${C}.rank`),
    t(`${C}.reference`),
    t(`${C}.person`),
    t(`${C}.fileNumber`),
    t(`${C}.list`),
    t(`${C}.priority`),
    t(`${C}.registered`),
    t(`${C}.waitedDays`),
    t(`${C}.state`),
    t(`${C}.exitReason`),
    t(`${C}.consent`),
    t(`${C}.fee`),
    t(`${C}.lastContact`),
    t(`${C}.nextContact`),
  ]
  const day = (iso: string | null) => (iso ? getClinicDateString(iso) : null)
  const body: CsvCell[][] = rows.map((r) => [
    r.rank === null ? null : csvNumber(r.rank),
    r.reference,
    personLabel(r),
    fileNumber(r.client_number),
    r.target_name,
    r.priority === 'priority' ? t(`${W}.priority.priority`) : null,
    day(r.registered_at),
    csvNumber(Math.max(r.waited_days, 0)),
    entryStateLabel(r.state),
    r.exit_reason ? exitReasonLabel(r.exit_reason) : null,
    r.consent_state ? consentLabel(r.consent_state) : t(`${W}.consent.none`),
    feeLabel(r.fee_status),
    day(r.last_contact_at),
    day(r.next_contact_at),
  ])
  return { fileName: t(`${C}.fileName`, { date: today }), content: buildCsv(header, body) }
}

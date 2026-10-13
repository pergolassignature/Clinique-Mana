import { t } from '@/i18n'
import type { StatusTone } from '@/shared/ui/status-dot'
import type { MatchStatus, QboConnection, QboSyncResult } from '../api/quickbooks'

const S = 'modules.billing.qbo'

/** The connection's state in plain words (« il faut toujours être clair »). */
export function connectionStatus(connection: QboConnection | null): { tone: StatusTone; label: string; detail: string | null } {
  if (!connection || connection.status === 'disconnected') {
    return { tone: 'neutral', label: t(`${S}.status.notConnected`), detail: null }
  }
  if (connection.status === 'needs_reconnect') {
    return { tone: 'warning', label: t(`${S}.status.needsReconnect`), detail: t(`${S}.status.needsReconnectDetail`) }
  }
  if (connection.last_sync_status === 'failed') {
    return { tone: 'warning', label: t(`${S}.status.syncFailed`), detail: t(`${S}.status.syncFailedDetail`) }
  }
  return { tone: 'success', label: t(`${S}.status.connected`), detail: null }
}

/** One plural line: « 1 compte » / « 12 comptes ». */
function counted(key: string, count: number): string {
  return t(count === 1 ? `${S}.counts.${key}One` : `${S}.counts.${key}Other`, { count: String(count) })
}

/** What « Synchroniser » did, for the line beside the button. */
export function syncOutcome(result: QboSyncResult): { ok: boolean; text: string } {
  if (result.status === 'failed') return { ok: false, text: t(`${S}.sync.failed`) }
  const read = t(`${S}.sync.read`, { accounts: counted('accounts', result.accounts), customers: counted('customers', result.customers) })
  return { ok: true, text: result.pending ? `${read} ${t(`${S}.sync.pending`)}` : read }
}

/** The report's tabs, in their order. */
export const MATCH_TABS: MatchStatus[] = ['to_decide', 'linked', 'no_match', 'ignored']

/** A match's reasons (Clients' duplicate codes) in French; an unknown code is left out. */
export function reasonText(reason: string): string | null {
  const known: Record<string, string> = {
    email: t(`${S}.customers.reasons.email`),
    phone: t(`${S}.customers.reasons.phone`),
    same_name: t(`${S}.customers.reasons.same_name`),
    similar_name: t(`${S}.customers.reasons.similar_name`),
    birthday: t(`${S}.customers.reasons.birthday`),
    birthday_differs: t(`${S}.customers.reasons.birthday_differs`),
    shared_contact: t(`${S}.customers.reasons.shared_contact`),
    partial_email: t(`${S}.customers.reasons.partial_email`),
    partial_phone: t(`${S}.customers.reasons.partial_phone`),
  }
  return known[reason] ?? null
}

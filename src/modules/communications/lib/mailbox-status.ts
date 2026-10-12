import { t } from '@/i18n'
import type { StatusTone } from '@/shared/ui/status-dot'
import type { MailConnection, SyncResult } from '../api/mailboxes'

const S = 'modules.communications.settings.gmail.mailboxes'

export interface MailboxStatus {
  label: string
  tone: StatusTone
  /** What to do or what happened, in plain French; never a code. */
  detail?: string
}

/** Why Google refused the mailbox (`status_reason`), in plain words. */
function reconnectReason(reason: string | null): string {
  switch (reason) {
    case 'invalid_grant':
      return t(`${S}.reason.invalidGrant`)
    case 'scope_missing':
      return t(`${S}.reason.scopeMissing`)
    default:
      return t(`${S}.reason.other`)
  }
}

/**
 * One mailbox's state, the same words wherever it shows (« Courriels Gmail », later the inbox's
 * left pane): disconnected, to reconnect (with why), syncing, the last sync failed, the first
 * pass not finished, or connected.
 */
export function mailboxStatus(mailbox: MailConnection): MailboxStatus {
  if (mailbox.status === 'disconnected') return { label: t(`${S}.status.disconnected`), tone: 'neutral' }
  if (mailbox.status === 'needs_reconnect') {
    return { label: t(`${S}.status.needsReconnect`), tone: 'error', detail: reconnectReason(mailbox.status_reason) }
  }
  if (mailbox.sync_in_progress) return { label: t(`${S}.status.syncing`), tone: 'info' }
  if (mailbox.last_sync_status === 'error') {
    return { label: t(`${S}.status.error`), tone: 'warning', detail: t(`${S}.status.errorDetail`) }
  }
  if (!mailbox.initial_sync_done) {
    return { label: t(`${S}.status.firstPass`), tone: 'info', detail: t(`${S}.status.firstPassDetail`) }
  }
  return { label: t(`${S}.status.connected`), tone: 'success' }
}

/** The outcome of « Synchroniser », said beside the button. */
export function syncOutcomeText(result: SyncResult): { ok: boolean; text: string } {
  switch (result.outcome) {
    case 'synced':
      return {
        ok: true,
        text: result.initial_pending
          ? t(result.messages === 1 ? `${S}.syncOutcome.partialOne` : `${S}.syncOutcome.partialOther`, { count: String(result.messages) })
          : result.messages === 0
            ? t(`${S}.syncOutcome.nothingNew`)
            : t(result.messages === 1 ? `${S}.syncOutcome.doneOne` : `${S}.syncOutcome.doneOther`, { count: String(result.messages) }),
      }
    case 'skipped':
      return { ok: true, text: t(`${S}.syncOutcome.skipped`) }
    case 'needs_reconnect':
      return { ok: false, text: t(`${S}.syncOutcome.needsReconnect`) }
    default:
      return { ok: false, text: t(`${S}.syncOutcome.failed`) }
  }
}

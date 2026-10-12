import type { MailConnection } from '../api/mailboxes'

/** A connected shared mailbox, fully synced (test-only). */
export const MAILBOX: MailConnection = {
  id: 'c0000000-0000-0000-0000-000000000001',
  email_address: 'info@clinique.test',
  kind: 'shared',
  status: 'connected',
  status_reason: null,
  scopes: ['https://www.googleapis.com/auth/gmail.modify'],
  connected_at: '2026-10-12T15:00:00+00:00',
  connected_by_name: 'Admin Local',
  disconnected_at: null,
  last_sync_at: '2026-10-12T15:05:00+00:00',
  last_sync_status: 'ok',
  last_error_code: null,
  last_error_at: null,
  sync_in_progress: false,
  initial_sync_done: true,
  watch_expires_at: null,
  messages_synced: 12,
  thread_count: 9,
  unread_count: 2,
}

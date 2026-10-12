import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { MAILBOX } from '../test/fixtures'
import { mailboxStatus, syncOutcomeText } from './mailbox-status'

const S = 'modules.communications.settings.gmail.mailboxes'

describe('mailboxStatus', () => {
  it('words each state plainly, the most urgent first', () => {
    expect(mailboxStatus(MAILBOX)).toEqual({ label: t(`${S}.status.connected`), tone: 'success' })
    expect(mailboxStatus({ ...MAILBOX, status: 'disconnected' }).label).toBe(t(`${S}.status.disconnected`))
    expect(mailboxStatus({ ...MAILBOX, status: 'needs_reconnect', status_reason: 'invalid_grant', sync_in_progress: true })).toEqual({
      label: t(`${S}.status.needsReconnect`),
      tone: 'error',
      detail: t(`${S}.reason.invalidGrant`),
    })
    expect(mailboxStatus({ ...MAILBOX, status: 'needs_reconnect', status_reason: 'something_new' }).detail).toBe(t(`${S}.reason.other`))
    expect(mailboxStatus({ ...MAILBOX, sync_in_progress: true, last_sync_status: 'error' }).label).toBe(t(`${S}.status.syncing`))
    expect(mailboxStatus({ ...MAILBOX, last_sync_status: 'error', last_error_code: 'gmail_provider_error' })).toMatchObject({
      tone: 'warning',
      detail: t(`${S}.status.errorDetail`),
    })
    expect(mailboxStatus({ ...MAILBOX, initial_sync_done: false }).label).toBe(t(`${S}.status.firstPass`))
  })

  it('never shows a code', () => {
    const status = mailboxStatus({ ...MAILBOX, last_sync_status: 'error', last_error_code: 'gmail_provider_error' })
    expect(JSON.stringify(status)).not.toContain('gmail_provider_error')
  })
})

describe('syncOutcomeText', () => {
  const base = { messages: 0, attachments: 0, initial_pending: false }
  it('counts what was read, singular and plural', () => {
    expect(syncOutcomeText({ ...base, outcome: 'synced' })).toEqual({ ok: true, text: t(`${S}.syncOutcome.nothingNew`) })
    expect(syncOutcomeText({ ...base, outcome: 'synced', messages: 1 }).text).toBe(t(`${S}.syncOutcome.doneOne`))
    expect(syncOutcomeText({ ...base, outcome: 'synced', messages: 4 }).text).toBe(t(`${S}.syncOutcome.doneOther`, { count: '4' }))
    expect(syncOutcomeText({ ...base, outcome: 'synced', messages: 50, initial_pending: true }).text).toBe(
      t(`${S}.syncOutcome.partialOther`, { count: '50' }),
    )
  })

  it('says a held lease, a refused access and a failure', () => {
    expect(syncOutcomeText({ ...base, outcome: 'skipped' }).ok).toBe(true)
    expect(syncOutcomeText({ ...base, outcome: 'needs_reconnect' })).toEqual({ ok: false, text: t(`${S}.syncOutcome.needsReconnect`) })
    expect(syncOutcomeText({ ...base, outcome: 'error', code: 'gmail_timeout' })).toEqual({ ok: false, text: t(`${S}.syncOutcome.failed`) })
  })
})

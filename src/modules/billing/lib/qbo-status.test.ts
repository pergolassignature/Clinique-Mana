import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { accountFits, type QboConnection } from '../api/quickbooks'
import { connectionStatus, reasonText, syncOutcome } from './qbo-status'

const Q = 'modules.billing.qbo'

const connection = (over: Partial<QboConnection> = {}): QboConnection => ({
  id: 'q1',
  realm_id: '1',
  environment: 'production',
  company_name: 'Clinique',
  status: 'connected',
  status_reason: null,
  connected_at: '2026-10-13T12:00:00Z',
  connected_by_name: null,
  disconnected_at: null,
  refresh_token_expires_at: null,
  last_sync_at: null,
  last_sync_status: null,
  last_error_code: null,
  accounts_synced_at: null,
  customers_synced_at: null,
  ...over,
})

describe('connectionStatus', () => {
  it('says the state plainly', () => {
    expect(connectionStatus(null).label).toBe(t(`${Q}.status.notConnected`))
    expect(connectionStatus(connection({ status: 'disconnected' })).tone).toBe('neutral')
    expect(connectionStatus(connection({ status: 'needs_reconnect' }))).toMatchObject({ tone: 'warning', label: t(`${Q}.status.needsReconnect`) })
    expect(connectionStatus(connection({ last_sync_status: 'failed' })).label).toBe(t(`${Q}.status.syncFailed`))
    expect(connectionStatus(connection()).tone).toBe('success')
  })
})

describe('syncOutcome', () => {
  it('counts what was read, and says when the matching continues', () => {
    expect(syncOutcome({ status: 'ok', accounts: 1, customers: 12, matched: 3, pending: false }).text).toBe(
      t(`${Q}.sync.read`, { accounts: t(`${Q}.counts.accountsOne`), customers: t(`${Q}.counts.customersOther`, { count: '12' }) }),
    )
    expect(syncOutcome({ status: 'partial', accounts: 2, customers: 2, matched: 0, pending: true }).text).toContain(t(`${Q}.sync.pending`))
    expect(syncOutcome({ status: 'failed', accounts: 0, customers: 0, matched: 0, pending: false })).toEqual({ ok: false, text: t(`${Q}.sync.failed`) })
  })
})

describe('reasonText and accountFits', () => {
  it('names Clients’ reasons in French and leaves out unknown codes', () => {
    expect(reasonText('email')).toBe(t(`${Q}.customers.reasons.email`))
    expect(reasonText('nope')).toBeNull()
  })

  it('accepts the account types the database accepts, any payment mode included', () => {
    expect(accountFits('revenue.services', 'Income')).toBe(true)
    expect(accountFits('revenue.services', 'Bank')).toBe(false)
    expect(accountFits('deposit.especes', 'Bank')).toBe(true)
    expect(accountFits('deposit.interac', 'Other Current Asset')).toBe(true)
    expect(accountFits('expense', 'Cost of Goods Sold')).toBe(true)
    expect(accountFits('other', 'Income')).toBe(false)
  })
})

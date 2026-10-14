import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { PUSH_KINDS } from '../api/quickbooks'
import { pushErrorText, pushKindLabel } from './qbo-push'

const P = 'modules.billing.qbo.push'

describe('pushKindLabel', () => {
  it('names every kind in French, a refund included', () => {
    expect(pushKindLabel('refund')).toBe('Remboursement')
    for (const kind of PUSH_KINDS) expect(pushKindLabel(kind)).not.toContain('modules.')
  })
})

describe('pushErrorText', () => {
  it('a known code in plain words, any other as « Erreur inattendue »', () => {
    expect(pushErrorText(null)).toBeNull()
    expect(pushErrorText('missing_map')).toBe(t(`${P}.errors.missing_map`))
    // BI-28: a Bill forgotten after its deletion in QuickBooks.
    expect(pushErrorText('bill_voided')).toBe(t(`${P}.errors.bill_voided`))
    expect(pushErrorText('refund_incomplete')).toBe(t(`${P}.errors.other`))
  })
})

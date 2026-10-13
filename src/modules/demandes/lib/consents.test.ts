import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { allConsentsValid, fileConsentStatus } from './consents'
import { countWarning } from './participants'

const C = 'modules.demandes.participants.consents'
const general = (state: 'signed' | 'resign' | 'pending' | 'overdue' | 'missing') => ({ key: 'general', name: 'Consentement général', state })

describe('fileConsentStatus', () => {
  it('says « Consentements valides » when every required consent is signed', () => {
    expect(fileConsentStatus({ client_id: 'c1', consents: [general('signed')] })).toEqual({ tone: 'success', label: t(`${C}.valid`), valid: true })
  })

  it('names each consent to settle, what needs doing first', () => {
    const status = fileConsentStatus({
      client_id: 'c1',
      consents: [{ key: 'eap', name: 'PAE externe', state: 'pending' }, general('missing'), { key: 'intern', name: 'Stagiaire', state: 'signed' }],
    })
    expect(status.valid).toBe(false)
    expect(status.tone).toBe('warning')
    expect(status.label).toBe(
      `${t(`${C}.state.missing`, { name: 'Consentement général' })} · ${t(`${C}.state.pending`, { name: 'PAE externe' })}`,
    )
  })

  it('only waiting for a signature: informative, still not valid', () => {
    expect(fileConsentStatus({ client_id: 'c1', consents: [general('pending')] })).toMatchObject({ tone: 'info', valid: false })
  })

  it('nothing required', () => {
    expect(fileConsentStatus({ client_id: 'c1', consents: [] })).toEqual({ tone: 'secondary', label: t(`${C}.noneRequired`), valid: true })
  })

  it('the request: valid only when every file is', () => {
    expect(allConsentsValid([{ client_id: 'c1', consents: [general('signed')] }, { client_id: 'c2', consents: [] }])).toBe(true)
    expect(allConsentsValid([{ client_id: 'c1', consents: [general('signed')] }, { client_id: 'c2', consents: [general('resign')] }])).toBe(false)
  })
})

describe('countWarning', () => {
  const P = 'modules.demandes.participants.count'
  it('a couple is two people, a family two or more; other kinds say nothing', () => {
    expect(countWarning('couple', 2)).toBeNull()
    expect(countWarning('couple', 1)).toBe(t(`${P}.couple`, { count: '1' }))
    expect(countWarning('couple', 3)).toBe(t(`${P}.couple`, { count: '3' }))
    expect(countWarning('family', 3)).toBeNull()
    expect(countWarning('family', 1)).toBe(t(`${P}.family`, { count: '1' }))
    expect(countWarning('self', 4)).toBeNull()
    expect(countWarning(null, 0)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { consentSettled, feeSettled, rankLabel, targetFromParam, waitedLabel, waitlistPath } from './waitlist'

const ID = '10000000-0000-0000-0000-000000000001'

describe('waitlist display', () => {
  it('the address names one list and a state; and reads it back', () => {
    expect(waitlistPath()).toBe('/liste-attente')
    expect(waitlistPath({ kind: 'title', id: ID }, 'to_call')).toBe(`/liste-attente?liste=t-${ID}&etat=a-rappeler`)
    expect(targetFromParam(`p-${ID}`)).toEqual({ kind: 'professional', id: ID })
    expect(targetFromParam('t-pas-un-id')).toBeNull()
    expect(targetFromParam(null)).toBeNull()
  })

  it('the rank in French: « 1re », then « 2e »; none when closed', () => {
    expect(rankLabel({ rank: 1, list_size: 23 })).toBe('1re sur 23')
    expect(rankLabel({ rank: 7, list_size: 23 })).toBe('7e sur 23')
    expect(rankLabel({ rank: null, list_size: null })).toBeNull()
  })

  it('the days waited', () => {
    expect(waitedLabel(0)).toBe("Inscrite aujourd'hui")
    expect(waitedLabel(1)).toBe('En attente depuis 1 jour')
    expect(waitedLabel(34)).toBe('En attente depuis 34 jours')
  })

  it('what settles an entry (D-16)', () => {
    expect(['to_invoice', 'invoiced', 'paid', 'waived'].map((s) => feeSettled(s as never))).toEqual([false, false, true, true])
    expect(['signed', 'resign', 'pending', 'missing', 'not_required', null].map((s) => consentSettled(s as never))).toEqual([true, true, false, false, true, false])
  })
})

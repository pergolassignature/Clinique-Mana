import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { parsedRequest, SIGNED_FILE } from '../test/fixtures-contract'
import { contractButtons, contractState, contractStateLabel, isContractSigned, signerRoleLabel, type ContractState } from './contract'

const A = 'modules.professionals.contract.actions'
const ALL = ['professionals.view', 'professionals.contracts.send', 'professionals.compensation']
const can = (keys: string[]) => (key: string) => keys.includes(key)
/** The buttons as words: an action's label, « sync » or « pdf ». */
const words = (state: ContractState, request = parsedRequest(), keys = ALL) =>
  contractButtons(state, request, can(keys)).map((b) => (b.kind === 'action' ? b.label : b.kind))

describe('contractState', () => {
  it('reads each request status; none without a request', () => {
    expect(contractState(null)).toBe('none')
    for (const status of ['sent', 'viewed', 'signed', 'rejected', 'expired', 'cancelled'] as const) {
      expect(contractState(parsedRequest({ status }))).toBe(status)
    }
  })

  it('splits a draft: sending (no error yet), failed (an error), abandoned', () => {
    expect(contractState(parsedRequest({ status: 'draft' }))).toBe('sending')
    expect(contractState(parsedRequest({ status: 'draft', lastError: 'provider_error' }))).toBe('failed')
    expect(contractState(parsedRequest({ status: 'draft', lastError: 'abandoned' }))).toBe('abandoned')
  })
})

describe('contractButtons (P4-436: sending needs contracts.send and compensation)', () => {
  it('offers « Préparer et envoyer » for no contract', () => {
    expect(words('none', parsedRequest())).toEqual([t(`${A}.send`)])
  })

  it('offers synchronise, resend and regenerate while out for signature', () => {
    for (const state of ['sent', 'viewed'] as const) {
      expect(words(state)).toEqual(['sync', t(`${A}.resend`), t(`${A}.regenerate`)])
    }
  })

  it('retries the same request after a failed send, or regenerates', () => {
    expect(words('failed')).toEqual([t(`${A}.retry`), t(`${A}.regenerate`)])
    expect(contractButtons('failed', parsedRequest(), can(ALL))[0]).toMatchObject({ kind: 'action', action: 'send' })
  })

  it('only synchronises while a send runs', () => {
    expect(words('sending')).toEqual(['sync'])
  })

  it('regenerates a refused, expired, cancelled or abandoned contract', () => {
    for (const state of ['rejected', 'expired', 'cancelled', 'abandoned'] as const) expect(words(state)).toEqual([t(`${A}.regenerate`)])
  })

  it('opens the signed PDF when stored and readable', () => {
    expect(words('signed', parsedRequest({ status: 'signed', signedFileId: SIGNED_FILE }))).toEqual(['pdf'])
    expect(words('signed', parsedRequest({ status: 'signed', signedFileId: null }))).toEqual([])
  })

  it('a reader without contracts.send or compensation sends nothing', () => {
    for (const keys of [['professionals.view'], ['professionals.view', 'professionals.contracts.send'], ['professionals.view', 'professionals.compensation']]) {
      expect(words('none', parsedRequest(), keys)).toEqual([])
      expect(words('rejected', parsedRequest(), keys)).toEqual([])
      expect(words('sent', parsedRequest(), keys)).toEqual(['sync'])
    }
  })

  it('who cannot read the request (P4-435) neither synchronises nor opens the PDF', () => {
    const hidden = parsedRequest({ canRead: false })
    expect(words('sent', hidden, ['professionals.view'])).toEqual([])
    expect(words('sending', hidden)).toEqual([])
    expect(words('signed', parsedRequest({ status: 'signed', canRead: false, signedFileId: null }), ['professionals.view'])).toEqual([])
  })
})

describe('contractStateLabel', () => {
  it('« Aucun contrat » without a request, « Envoi en cours » for a draft without an error', () => {
    expect(contractStateLabel(null).label).toBe(t('modules.professionals.contract.state.none'))
    expect(contractStateLabel(parsedRequest({ status: 'draft' })).label).toBe(t('modules.professionals.contract.state.sending'))
  })

  it('uses core’s words otherwise, so the card and « Signature électronique » agree', () => {
    expect(contractStateLabel(parsedRequest({ status: 'signed' }))).toMatchObject({ label: 'Signé', tone: 'success' })
  })
})

describe('helpers', () => {
  it('a signed contract is what readiness counts', () => {
    expect(isContractSigned(parsedRequest({ status: 'signed' }))).toBe(true)
    expect(isContractSigned(parsedRequest({ status: 'viewed' }))).toBe(false)
    expect(isContractSigned(null)).toBe(false)
  })

  it('names the signer roles in French, an unknown role as is', () => {
    expect(signerRoleLabel('professional')).toBe('Professionnel')
    expect(signerRoleLabel('clinic')).toBe('Clinique')
    expect(signerRoleLabel('witness')).toBe('witness')
  })
})

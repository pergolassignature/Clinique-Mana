import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { parsedRequest, SIGNED_FILE } from '../test/fixtures-contract'
import { parsedContract, contractJson, requestJson } from '../test/fixtures-contract'
import { contractButtons, contractProgress, contractState, contractStateLabel, signerRoleLabel, STALE_SEND_MS, type ContractState } from './contract'

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
    expect(contractState(parsedRequest({ status: 'draft' }), Date.parse('2026-10-08T14:00:00Z'))).toBe('sending')
    expect(contractState(parsedRequest({ status: 'draft', lastError: 'provider_error' }))).toBe('failed')
    expect(contractState(parsedRequest({ status: 'draft', lastError: 'abandoned' }))).toBe('abandoned')
  })
})

describe('a send that died (review of 4d)', () => {
  const claimed = Date.parse('2026-10-08T14:00:00Z')
  const draft = parsedRequest({ status: 'draft', sendStartedAt: '2026-10-08T14:00:00Z' })

  it('a draft without an error is « Envoi en cours » while its claim is fresh, then failed', () => {
    expect(contractState(draft, claimed + STALE_SEND_MS)).toBe('sending')
    expect(contractState(draft, claimed + STALE_SEND_MS + 1)).toBe('failed')
    expect(contractStateLabel(draft, claimed + 60_000).label).toBe(t('modules.professionals.contract.state.sending'))
    expect(contractStateLabel(draft, claimed + STALE_SEND_MS + 1)).toEqual({
      label: t('modules.professionals.contract.state.stalled'),
      tone: 'error',
      detail: t('modules.professionals.contract.state.stalledDetail'),
    })
  })

  it('then offers the failed state’s retry and regenerate', () => {
    expect(words(contractState(draft, claimed + STALE_SEND_MS + 1), draft)).toEqual([t(`${A}.retry`), t(`${A}.regenerate`)])
  })

  it('without a claim, the last send or the creation dates it', () => {
    const unclaimed = parsedRequest({ status: 'draft', sendStartedAt: null, lastSendAt: null, createdAt: '2026-10-08T14:00:00Z' })
    expect(contractState(unclaimed, claimed + STALE_SEND_MS + 1)).toBe('failed')
  })
})

describe('contractProgress (« Prochaine action »)', () => {
  it('nothing out: to send; out: waiting for the first signer who has not signed; signed or unknown: null', () => {
    expect(contractProgress(parsedContract(contractJson(null)))).toEqual({ kind: 'to_send' })
    expect(contractProgress(parsedContract(contractJson(requestJson({ status: 'rejected' }))))).toEqual({ kind: 'to_send' })
    expect(contractProgress(parsedContract(contractJson(requestJson())))).toEqual({ kind: 'awaiting', name: 'Marie Tremblay' })
    const proSigned = requestJson({
      status: 'viewed',
      signers: [
        { role: 'professional', name: 'Marie Tremblay', status: 'signed', signing_order: 1, viewed_at: null, signed_at: '2026-10-09T13:05:00+00:00', rejected_at: null },
        { role: 'clinic', name: 'Dominique Exemple', status: 'pending', signing_order: 2, viewed_at: null, signed_at: null, rejected_at: null },
      ],
    })
    expect(contractProgress(parsedContract(contractJson(proSigned)))).toEqual({ kind: 'awaiting', name: 'Dominique Exemple' })
    expect(contractProgress(parsedContract(contractJson(requestJson({ status: 'signed' }))))).toBeNull()
    expect(contractProgress(undefined)).toBeNull()
  })
})

describe('contractStateLabel: the professional signed, the clinic not yet', () => {
  const signers = (clinic: { signed_at: string | null; rejected_at: string | null }) => [
    { role: 'professional', name: 'Marie Tremblay', status: 'signed', signing_order: 1, viewed_at: null, signed_at: '2026-10-09T13:05:00+00:00', rejected_at: null },
    { role: 'clinic', name: 'Dominique Exemple', status: 'pending', signing_order: 2, viewed_at: null, ...clinic },
  ]
  it('reads « Signé par … · en attente de la signature de la clinique », never « Consulté »', () => {
    const request = parsedContract(contractJson(requestJson({ status: 'viewed', signers: signers({ signed_at: null, rejected_at: null }) }))).request
    expect(contractStateLabel(request).label).toBe('Signé par Marie Tremblay · en attente de la signature de la clinique')
  })
  it('core’s words otherwise: before the professional signs, or once the clinic has refused', () => {
    const viewed = parsedContract(contractJson(requestJson({ status: 'viewed' }))).request
    expect(contractStateLabel(viewed).label).not.toContain('Signé par')
    const refused = parsedContract(contractJson(requestJson({ status: 'viewed', signers: signers({ signed_at: null, rejected_at: '2026-10-09T14:00:00+00:00' }) }))).request
    expect(contractStateLabel(refused).label).not.toContain('Signé par')
  })
})

describe('contractButtons (P4-436: sending needs contracts.send and compensation)', () => {
  it('offers « Préparer le contrat » for no contract', () => {
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
    expect(contractStateLabel(parsedRequest({ status: 'draft' }), Date.parse('2026-10-08T14:00:00Z')).label).toBe(t('modules.professionals.contract.state.sending'))
  })

  it('uses core’s words otherwise, so the card and « Signature électronique » agree', () => {
    expect(contractStateLabel(parsedRequest({ status: 'signed' }))).toMatchObject({ label: 'Signé', tone: 'success' })
  })
})

describe('helpers', () => {
  it('names the signer roles in French, never the code', () => {
    expect(signerRoleLabel('professional')).toBe('Professionnel')
    expect(signerRoleLabel('clinic')).toBe('Clinique')
    expect(signerRoleLabel('witness')).toBe('Signataire')
  })
})

describe('the image consent (P4-481 – P4-486)', () => {
  const I = 'modules.professionals.imageConsent.actions'
  const MANAGE = ['professionals.view', 'professionals.manage']
  const consentWords = (state: ContractState, keys: string[], request = parsedRequest()) =>
    contractButtons(state, request, can(keys), 'image_consent').map((b) => (b.kind === 'action' ? b.label : b.kind))

  it('is sent by whoever manages the file, not by the contract senders (P4-484)', () => {
    expect(consentWords('none', MANAGE)).toEqual([t(`${I}.send`)])
    expect(consentWords('none', ALL)).toEqual([])
    expect(consentWords('sent', MANAGE)).toEqual(['sync', t(`${I}.resend`), t(`${I}.regenerate`)])
  })

  it('once signed offers a renewal, never the contract PDF button (the document row opens it)', () => {
    const signed = parsedRequest({ status: 'signed', signedFileId: SIGNED_FILE })
    expect(contractButtons('signed', signed, can(MANAGE), 'image_consent')).toEqual([{ kind: 'action', action: 'send', label: t(`${I}.renew`) }])
    expect(consentWords('signed', ['professionals.view'], signed)).toEqual([])
  })

  it('words its own empty state', () => {
    expect(contractStateLabel(null, Date.now(), 'image_consent').label).toBe(t('modules.professionals.imageConsent.state.none'))
  })
})

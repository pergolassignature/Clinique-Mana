import { describe, expect, it, vi } from 'vitest'
import * as Sentry from '@sentry/react'
import { FunctionCallError } from '@/core/supabase/functions'
import { consentSendErrorMessage, consentStateLabel, requestProgressLabel, ruleTriggerText, signedOnText } from './consents'

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

describe('consentStateLabel', () => {
  it('one plain word per state, with its dot', () => {
    expect(consentStateLabel('signed')).toEqual({ label: 'Signé', tone: 'success' })
    expect(consentStateLabel('resign')).toEqual({ label: 'À signer de nouveau', tone: 'warning' })
    expect(consentStateLabel('pending')).toEqual({ label: 'En attente de signature', tone: 'neutral' })
    expect(consentStateLabel('overdue')).toEqual({ label: 'En retard', tone: 'error' })
    expect(consentStateLabel('withdrawn')).toEqual({ label: 'Retiré', tone: 'error' })
    expect(consentStateLabel(null)).toEqual({ label: 'Pas demandé', tone: 'default' })
  })
})

describe('ruleTriggerText', () => {
  it('says what the rule asks for, in words', () => {
    expect(ruleTriggerText({ triggerKind: 'general', target: null })).toBe('Tous les clients')
    expect(ruleTriggerText({ triggerKind: 'payer_kind', target: 'pae' })).toBe('Payeur : PAE')
    expect(ruleTriggerText({ triggerKind: 'service', target: '10157' })).toBe('Le service 10157')
    expect(ruleTriggerText({ triggerKind: 'professional_status', target: 'intern' })).toBe('Professionnel stagiaire')
    expect(ruleTriggerText({ triggerKind: 'situation', target: 'waitlist' })).toBe('Situation : liste d’attente')
    expect(ruleTriggerText({ triggerKind: 'situation', target: 'file_transfer' })).toBe('Situation : transfert de dossier')
  })
})

describe('requestProgressLabel / signedOnText', () => {
  it('an open request in the consent’s own words, or how far it went', () => {
    const row = { isOverdue: false, signingStatus: null, answered: false }
    expect(requestProgressLabel({ ...row, isOverdue: true })).toEqual(consentStateLabel('overdue'))
    expect(requestProgressLabel(row)).toEqual(consentStateLabel('pending'))
    expect(requestProgressLabel({ ...row, answered: true }).label).toBe('Réponses données')
    expect(requestProgressLabel({ ...row, answered: true, signingStatus: 'viewed' }).label).toBe('Signature commencée')
  })

  it('no empty brackets without a version', () => {
    expect(signedOnText('2026-10-11T14:00:00Z', 'version 2')).toMatch(/^Signé le .+ \(version 2\)$/)
    expect(signedOnText('2026-10-11T14:00:00Z', null)).toMatch(/^Signé le [^()]+$/)
  })
})

describe('consentSendErrorMessage', () => {
  it('a refusal is shown as written; an unknown failure is reported with its code only', () => {
    const refusal = new FunctionCallError('invalid_request', 400, 'Le texte de ce consentement n’est pas encore publié.', { refusal: true })
    expect(consentSendErrorMessage(refusal)).toBe('Le texte de ce consentement n’est pas encore publié.')
    expect(consentSendErrorMessage(new FunctionCallError('weird_code', 500, 'boom'))).toBe('Impossible d’envoyer la demande.')
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.objectContaining({ name: 'FunctionCallError weird_code' }), {
      tags: { area: 'clients', code: 'weird_code' },
    })
    vi.mocked(Sentry.captureException).mockClear()
    consentSendErrorMessage(new FunctionCallError('conflict', 409, 'Busy'))
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
})

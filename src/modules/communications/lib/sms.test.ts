import { describe, expect, it, vi } from 'vitest'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { formatPhone, toE164 } from './phone'
import { smsSendErrorMessage, smsSendFailureCode } from './sms-errors'
import { smsConsentLabel, smsErrorText, smsStatusLabel } from './sms-status'
import { composerSchema, consentSchema, mentionsStop, pbxSchema, textsSchema } from '../schemas/sms'

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.communications.sms'

describe('toE164 / formatPhone (the database rule: private.sms_normalize_e164)', () => {
  it('reads the usual forms of a North American number', () => {
    for (const typed of ['514 555-1234', '(514) 555-1234', '5145551234', '1-514-555-1234', '+1 514 555 1234']) {
      expect(toE164(typed)).toBe('+15145551234')
    }
  })

  it('keeps an international number given with +, refuses the rest', () => {
    expect(toE164('+33 1 23 45 67 89')).toBe('+33123456789')
    for (const typed of ['555-1234', '0145551234', '', '   ', '+0123', 'abc', '25145551234']) expect(toE164(typed)).toBeNull()
  })

  it('shows a stored number the clinic way, any other as stored', () => {
    expect(formatPhone('+15145551234')).toBe('514 555-1234')
    expect(formatPhone('+33123456789')).toBe('+33123456789')
    expect(formatPhone(null)).toBe('')
  })
})

describe('sms status, consent and failure texts', () => {
  it('one word and a dot per status', () => {
    expect(smsStatusLabel('failed')).toEqual({ label: t(`${S}.status.failed`), tone: 'error' })
    expect(smsStatusLabel('sent').tone).toBe('success')
  })

  it('the consent in force, « Aucun consentement » without one', () => {
    expect(smsConsentLabel('opted_in').label).toBe(t(`${S}.consent.opted_in`))
    expect(smsConsentLabel('opted_out').tone).toBe('error')
    expect(smsConsentLabel(null).label).toBe(t(`${S}.consent.none`))
  })

  it('a known code reads in French; a PBX delivery code is named', () => {
    expect(smsErrorText('provider_rejected')).toBe(t(`${S}.errorCode.provider_rejected`))
    expect(smsErrorText('invalid_phone_number')).toBe(t(`${S}.errorCode.other`, { code: 'invalid_phone_number' }))
  })
})

describe('smsSendErrorMessage', () => {
  const opts = { failed: 'composer.failed' as const, fallback: 'FALLBACK' }

  it('a refusal reads as written (no consent)', () => {
    const error = new FunctionCallError('invalid_request', 400, 'Aucun texto ne peut être envoyé à ce numéro.', { refusal: true })
    expect(smsSendErrorMessage(error, opts)).toBe('Aucun texto ne peut être envoyé à ce numéro.')
  })

  it("a PBX failure gives the PBX's reason", () => {
    const error = new FunctionCallError('provider_error', 502, 'x', { extra: { sms_message_id: 'm', code: 'provider_rejected' } })
    expect(smsSendFailureCode(error)).toBe('provider_rejected')
    expect(smsSendErrorMessage(error, opts)).toBe(t(`${S}.composer.failed`, { reason: t(`${S}.errorCode.provider_rejected`) }))
  })

  it('the settings gap, the limit with its delay, an unknown code → the fallback', () => {
    expect(smsSendErrorMessage(new FunctionCallError('not_configured', 503, 'x'), opts)).toBe(t(`${S}.composer.notConfigured`))
    expect(smsSendErrorMessage(new FunctionCallError('rate_limited', 429, 'x', {}, 120), opts)).toMatch(new RegExp(`^${t(`${S}.composer.rateLimited`)} `))
    expect(smsSendErrorMessage(new FunctionCallError('weird', 500, 'x'), opts)).toBe('FALLBACK')
  })
})

describe('the forms mirror the SQL rules', () => {
  it('the consent text must say ARRÊT (any case, accent or not)', () => {
    expect(mentionsStop('Répondez ARRÊT pour ne plus en recevoir.')).toBe(true)
    expect(mentionsStop('répondez arret')).toBe(true)
    expect(mentionsStop('Répondez STOP')).toBe(false)
    expect(mentionsStop('arrêtez')).toBe(false)
    const short = textsSchema.safeParse({ consentText: 'ARRÊT', optOutReply: 'x'.repeat(30) })
    expect(short.success).toBe(false)
    const ok = textsSchema.safeParse({ consentText: 'Répondez ARRÊT pour ne plus recevoir nos textos.', optOutReply: 'Vous ne recevrez plus de textos.' })
    expect(ok.success).toBe(true)
  })

  it('the PBX form: https host only, the number as E.164, empty fields are null', () => {
    expect(pbxSchema.parse({ baseUrl: 'https://pbx.exemple.com/', clientId: ' abc ', did: '418 555-0199' })).toEqual({
      baseUrl: 'https://pbx.exemple.com',
      clientId: 'abc',
      did: '+14185550199',
    })
    expect(pbxSchema.parse({ baseUrl: '', clientId: '', did: '' })).toEqual({ baseUrl: null, clientId: null, did: null })
    expect(pbxSchema.safeParse({ baseUrl: 'http://pbx.exemple.com', clientId: '', did: '' }).success).toBe(false)
    expect(pbxSchema.safeParse({ baseUrl: 'https://pbx.exemple.com/api', clientId: '', did: '' }).success).toBe(false)
    expect(pbxSchema.safeParse({ baseUrl: '', clientId: '', did: '555-0199' }).success).toBe(false)
  })

  it('a consent needs a readable number; a reply 1 to 1600 characters', () => {
    expect(consentSchema.parse({ phone: '514-555-1234', note: ' Au téléphone ' })).toEqual({ phone: '+15145551234', note: 'Au téléphone' })
    expect(consentSchema.safeParse({ phone: '1234', note: '' }).success).toBe(false)
    expect(composerSchema.safeParse({ body: '   ' }).success).toBe(false)
    expect(composerSchema.safeParse({ body: 'x'.repeat(1601) }).success).toBe(false)
  })
})

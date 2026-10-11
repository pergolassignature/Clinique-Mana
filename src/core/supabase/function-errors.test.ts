import { describe, expect, it } from 'vitest'
import { t } from '@/i18n'
import { functionErrorText } from './function-errors'
import { FunctionCallError } from './functions'

const fail = (code: string, status = 400, extra: Record<string, unknown> = {}, retryAfter: number | null = null) =>
  new FunctionCallError(code, status, 'English message', extra, retryAfter)

describe('functionErrorText (C-4)', () => {
  it('gives each common code one text, whatever the feature', () => {
    expect(functionErrorText(fail('network', 0))).toBe(t('common.functionErrors.network'))
    expect(functionErrorText(fail('unauthenticated', 401))).toBe(t('common.functionErrors.unauthenticated'))
    expect(functionErrorText(fail('forbidden', 403))).toBe(t('common.errors.forbidden'))
    expect(functionErrorText(fail('module_disabled', 403))).toBe(t('common.functionErrors.moduleDisabled'))
    expect(functionErrorText(fail('auth_unavailable', 503))).toBe(t('common.functionErrors.unavailable'))
    expect(functionErrorText(fail('network', 0), { service: 'signing', audience: 'professional' })).toBe(t('common.functionErrors.network'))
  })

  it('names the service of not_configured and provider_error, for staff or a professional', () => {
    expect(functionErrorText(fail('not_configured', 503), { service: 'email' })).toBe(t('common.functionErrors.notConfigured.email.staff'))
    expect(functionErrorText(fail('not_configured', 503), { service: 'signing', audience: 'professional' })).toBe(
      t('common.functionErrors.notConfigured.signing.professional'),
    )
    expect(functionErrorText(fail('provider_error', 502), { service: 'signing' })).toBe(t('common.functionErrors.providerError.signing'))
    expect(functionErrorText(fail('not_configured', 503))).toBe(t('common.functionErrors.unavailable'))
    expect(functionErrorText(fail('provider_error', 502))).toBe(t('common.functionErrors.unavailable'))
  })

  it('never names Documenso or Paramètres to a professional', () => {
    for (const code of ['not_configured', 'provider_error']) {
      const text = functionErrorText(fail(code, 503), { service: 'signing', audience: 'professional' }) ?? ''
      expect(text).not.toMatch(/Documenso|Paramètres/)
    }
  })

  it('says when to retry after a limit, with the feature noun when it has one', () => {
    expect(functionErrorText(fail('rate_limited', 429, {}, 2700))).toBe(`${t('common.functionErrors.rateLimited')} Réessayez dans environ 45 minutes.`)
    expect(functionErrorText(fail('rate_limited', 429), { overrides: { rate_limited: () => 'Trop de fiches.' } })).toBe(`Trop de fiches. ${t('common.retryIn.later')}`)
  })

  it('passes a refusal on as written, and lets a feature word a code its own way', () => {
    expect(functionErrorText(fail('invalid_request', 400, { refusal: true }), {})).toBe('English message')
    expect(functionErrorText(fail('conflict', 409), { overrides: { conflict: () => 'Un envoi est déjà en cours.' } })).toBe('Un envoi est déjà en cours.')
  })

  it('is null for an unknown code or another error (the caller reports it)', () => {
    expect(functionErrorText(fail('internal', 500))).toBeNull()
    expect(functionErrorText(fail('conflict', 409))).toBeNull()
    expect(functionErrorText(new Error('x'))).toBeNull()
  })
})

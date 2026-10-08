import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '@/i18n'
import { EmailFunctionError } from './api'
import { emailErrorMessage } from './errors'

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/react', () => mocks)

afterEach(() => vi.clearAllMocks())

const fail = (code: string, status: number, message = 'x', variable?: string) => new EmailFunctionError(code, status, message, variable)

describe('emailErrorMessage', () => {
  it.each([
    ['not_configured', 503, "L'envoi de courriels n'est pas encore configuré."],
    ['rate_limited', 429, "Trop d'envois en peu de temps. Réessayez dans quelques minutes."],
    ['provider_error', 502, "Le service d'envoi n'a pas répondu. Réessayez."],
  ])('says %s in French', (code, status, text) => {
    expect(emailErrorMessage(fail(code, status))).toBe(text)
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('names the unknown variable of an invalid draft', () => {
    expect(emailErrorMessage(fail('invalid_request', 400, 'Unknown variable', 'client.diagnosis'))).toBe('Variable inconnue : {{client.diagnosis}}')
  })

  it('shows the unclosed-braces message as the function sends it', () => {
    expect(emailErrorMessage(fail('invalid_request', 400, 'Accolades non fermées dans le texte.'))).toBe('Accolades non fermées dans le texte.')
  })

  it('never shows another (English) message of the function', () => {
    expect(emailErrorMessage(fail('invalid_request', 400, 'Invalid recipient'))).toBe(t('settings.email.errors.invalid_request'))
    expect(emailErrorMessage(fail('invalid_request', 413, 'Preview too large'))).toBe(t('settings.email.errors.tooLarge'))
  })

  it('maps the permission, module, template and network refusals', () => {
    expect(emailErrorMessage(fail('forbidden', 403))).toBe(t('common.errors.forbidden'))
    expect(emailErrorMessage(fail('module_disabled', 403))).toBe(t('settings.email.errors.module_disabled'))
    expect(emailErrorMessage(fail('not_found', 404))).toBe(t('settings.email.errors.not_found'))
    expect(emailErrorMessage(fail('unauthenticated', 401))).toBe(t('settings.email.errors.unauthenticated'))
    expect(emailErrorMessage(fail('network', 0))).toBe(t('settings.email.errors.network'))
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('reports anything else (code and message only) and shows the generic text', () => {
    expect(emailErrorMessage(fail('internal', 500, 'Preview failed'))).toBe(t('common.errors.generic'))
    expect(emailErrorMessage(new Error('boom'))).toBe(t('common.errors.generic'))
    expect(mocks.captureException).toHaveBeenCalledTimes(2)
    const [report, context] = mocks.captureException.mock.calls[0]!
    expect(report).toBeInstanceOf(Error)
    expect((report as Error).name).toBe('EmailFunctionError internal')
    expect((report as Error).message).toBe('Preview failed')
    expect(context).toEqual({ tags: { area: 'settings', code: 'internal' } })
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { retryInText } from '@/shared/lib/retry-after'
import { signingErrorMessage } from './errors'

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => vi.clearAllMocks())

describe('signingErrorMessage', () => {
  it.each([
    [new FunctionCallError('not_configured', 503, 'Signing is not configured'), 'settings.signing.errors.not_configured'],
    [new FunctionCallError('provider_error', 502, 'Documenso did not answer'), 'settings.signing.errors.provider_error'],
    [new FunctionCallError('conflict', 409, 'Un envoi est déjà en cours.'), 'settings.signing.errors.conflict'],
    [new FunctionCallError('not_found', 404, 'Not found'), 'settings.signing.errors.not_found'],
    [new FunctionCallError('unauthenticated', 401, 'Missing token'), 'settings.signing.errors.unauthenticated'],
    [new FunctionCallError('network', 0, 'Function unreachable'), 'settings.signing.errors.network'],
    [new FunctionCallError('forbidden', 403, 'Forbidden'), 'common.errors.forbidden'],
  ] as const)('reads %s in French, without reporting it', (error, key) => {
    expect(signingErrorMessage(error)).toBe(t(key))
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('gives a 429 its delay', () => {
    const error = new FunctionCallError('rate_limited', 429, 'Too many requests', {}, 1800)
    expect(signingErrorMessage(error)).toBe(`${t('settings.signing.errors.rate_limited')} ${retryInText(1800)}`)
  })

  it("passes a database refusal's French message on as is", () => {
    const error = new FunctionCallError('invalid_request', 400, 'Les signataires ne correspondent pas à la demande existante.')
    expect(signingErrorMessage(error)).toBe('Les signataires ne correspondent pas à la demande existante.')
  })

  it('reports anything else (code and message only) and shows the generic text', () => {
    expect(signingErrorMessage(new FunctionCallError('internal', 500, 'Test failed'))).toBe(t('common.errors.generic'))
    expect(mocks.captureException).toHaveBeenCalledOnce()
    const [report, context] = mocks.captureException.mock.calls[0] as [Error, unknown]
    expect(report.name).toBe('FunctionCallError internal')
    expect(report.message).toBe('Test failed')
    expect(context).toEqual({ tags: { area: 'settings', code: 'internal' } })
  })

  it('sends an RPC error through moduleErrorMessage', () => {
    expect(signingErrorMessage({ code: 'P0001', message: 'Refus en français.' })).toBe('Refus en français.')
  })
})

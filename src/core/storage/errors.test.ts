import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { UploadSendError } from './api'
import { previewErrorMessage, uploadErrorMessage } from './errors'

const captureException = vi.hoisted(() => vi.fn())
vi.mock('@sentry/react', () => ({ captureException }))

afterEach(() => vi.clearAllMocks())

const fnError = (code: string, status: number, message = 'x', retryAfter: number | null = null) => new FunctionCallError(code, status, message, {}, retryAfter)

describe('uploadErrorMessage', () => {
  it.each([
    ['Ce fichier dépasse la taille permise (2 Mo).'],
    ["Ce fichier n'est pas du type annoncé."],
    ["Le fichier n'a pas été reçu."],
    ['Cette image dépasse la taille permise (4 000 pixels de côté).'],
  ])('shows the French refusal of the functions as is: %s', (message) => {
    expect(uploadErrorMessage(fnError('invalid_request', 400, message))).toBe(message)
    expect(captureException).not.toHaveBeenCalled()
  })

  it('never shows a technical 400; reports it', () => {
    expect(uploadErrorMessage(fnError('invalid_request', 400, 'Invalid request body'))).toBe(t('common.errors.generic'))
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it('a 429 says so, with the delay, and is not reported', () => {
    expect(uploadErrorMessage(fnError('rate_limited', 429, 'Too many attempts', 1500))).toBe(
      `${t('storage.errors.rateLimited')} Réessayez dans environ 25 minutes.`,
    )
    expect(captureException).not.toHaveBeenCalled()
  })

  it.each([
    ['unauthenticated', 401, 'Votre session a expiré. Reconnectez-vous.'],
    ['forbidden', 403, t('common.errors.forbidden')],
    ['not_found', 404, t('storage.errors.expired')],
    ['conflict', 409, t('storage.errors.conflict')],
    ['network', 0, t('storage.errors.network')],
    ['not_configured', 503, t('storage.errors.unavailable')],
  ])('%s has its own text', (code, status, text) => {
    expect(uploadErrorMessage(fnError(code, status))).toBe(text)
    expect(captureException).not.toHaveBeenCalled()
  })

  it('a send that failed without a status (the network) has the connection text, not reported', () => {
    expect(uploadErrorMessage(new UploadSendError(null))).toBe(t('storage.errors.sendFailed'))
    expect(captureException).not.toHaveBeenCalled()
  })

  it.each([400, 403, 409, 413])('a send refused by storage (%i) asks for the file again; its status is reported, nothing else', (status) => {
    expect(uploadErrorMessage(new UploadSendError(status))).toBe(t('storage.errors.sendRefused'))
    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: `UploadSendError ${status}` }), {
      tags: { area: 'storage', status: String(status) },
    })
    const [report] = captureException.mock.calls[0] ?? []
    expect((report as Error).message).not.toMatch(/\/|token/)
  })

  it('a send that failed on a 5xx has the connection text; its status is reported', () => {
    expect(uploadErrorMessage(new UploadSendError(502))).toBe(t('storage.errors.sendFailed'))
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ name: 'UploadSendError 502' }), { tags: { area: 'storage', status: '502' } })
  })

  it("set_org_asset's refusal (P0001) is shown as is", () => {
    expect(uploadErrorMessage({ code: 'P0001', message: 'Fichier introuvable.' })).toBe('Fichier introuvable.')
  })

  it('anything else is the generic text, reported with its code only', () => {
    expect(uploadErrorMessage(fnError('internal', 500, 'Upload could not be prepared'))).toBe(t('common.errors.generic'))
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ name: 'FunctionCallError internal' }), { tags: { area: 'storage', code: 'internal' } })
  })
})

describe('previewErrorMessage', () => {
  it('a 429 says so, with the delay', () => {
    expect(previewErrorMessage(fnError('rate_limited', 429, 'Too many attempts', 30))).toBe(`${t('storage.errors.signRateLimited')} Réessayez dans un instant.`)
  })

  it('anything else: the preview is unavailable', () => {
    expect(previewErrorMessage(fnError('not_found', 404))).toBe(t('storage.preview.unavailable'))
  })
})

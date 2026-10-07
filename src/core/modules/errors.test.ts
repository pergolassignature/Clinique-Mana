import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '@/i18n'
import { moduleErrorMessage } from './errors'

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => mocks.captureException.mockReset())

const FALLBACK = 'FALLBACK'
const pgError = (code: string, message: string) => ({ code, message, details: '', hint: '' })

describe('moduleErrorMessage', () => {
  it('shows our business-rule message (P0001) as is', () => {
    expect(moduleErrorMessage(pgError('P0001', "Activez d'abord : Professionnels"), FALLBACK)).toBe("Activez d'abord : Professionnels")
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('maps a permission error (42501) to the generic forbidden text', () => {
    expect(moduleErrorMessage(pgError('42501', 'Permission refusée : modules.manage'), FALLBACK)).toBe(t('common.errors.forbidden'))
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('maps a check violation (23514) to the invalid-value text, without reporting it', () => {
    // The client validates first, so this only happens when the UI is bypassed: not a bug to report.
    const error = pgError('23514', 'new row for relation "organizations" violates check constraint "organizations_neq_format"')
    expect(moduleErrorMessage(error, FALLBACK)).toBe(t('common.errors.invalidValue'))
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('does not show a raw P0001 message when it is empty', () => {
    expect(moduleErrorMessage(pgError('P0001', ''), FALLBACK)).toBe(FALLBACK)
  })

  it.each([
    ['57014', 'canceling statement due to statement timeout'],
    ['40P01', 'deadlock detected'],
    ['PGRST303', 'JWT expired'],
    ['22023', 'Module inconnu : ghost'],
  ])('falls back for other database errors (%s) and reports them', (code, message) => {
    const error = pgError(code, message)
    expect(moduleErrorMessage(error, FALLBACK)).toBe(FALLBACK)
    expect(mocks.captureException).toHaveBeenCalledWith(error, expect.anything())
  })

  it('tags the Sentry report with the area, modules by default', () => {
    const error = pgError('57014', 'canceling statement due to statement timeout')
    moduleErrorMessage(error, FALLBACK)
    expect(mocks.captureException).toHaveBeenLastCalledWith(error, { tags: { area: 'modules' } })
    moduleErrorMessage(error, FALLBACK, 'settings')
    expect(mocks.captureException).toHaveBeenLastCalledWith(error, { tags: { area: 'settings' } })
  })

  it('falls back for network errors (empty code)', () => {
    expect(moduleErrorMessage(pgError('', 'TypeError: Failed to fetch'), FALLBACK)).toBe(FALLBACK)
  })

  it.each([[null], [undefined], ['boom'], [new Error('boom')]])('falls back for a non-database value (%s)', (value) => {
    expect(moduleErrorMessage(value, FALLBACK)).toBe(FALLBACK)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '@/i18n'
import { moduleErrorMessage } from './errors'

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

afterEach(() => mocks.captureException.mockReset())

const FALLBACK = 'FALLBACK'
const pgError = (code: string, message: string) => ({ code, message, details: '', hint: '' })

/** The Error sent to Sentry (first argument of the last captureException call). */
const reported = () => mocks.captureException.mock.lastCall?.[0] as Error

describe('moduleErrorMessage', () => {
  it('shows our business-rule message (P0001) as is', () => {
    expect(moduleErrorMessage(pgError('P0001', "Activez d'abord : Professionnels"), FALLBACK)).toBe("Activez d'abord : Professionnels")
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('maps a permission error (42501) to the generic forbidden text', () => {
    expect(moduleErrorMessage(pgError('42501', 'Permission refusée : modules.manage'), FALLBACK)).toBe(t('common.errors.forbidden'))
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('maps a check violation (23514) to the invalid-value text, and reports it', () => {
    // The client validates first, so this only follows a bypass or a Zod/SQL parity bug: we want to hear about either.
    const error = pgError('23514', 'new row for relation "organizations" violates check constraint "organizations_neq_check"')
    expect(moduleErrorMessage(error, FALLBACK, 'settings')).toBe(t('common.errors.invalidValue'))
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { area: 'settings', code: '23514' } })
    expect(reported().name).toBe('RpcError 23514')
    expect(reported().message).toBe(error.message)
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
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), { tags: { area: 'modules', code } })
    expect(reported().name).toBe(`RpcError ${code}`)
  })

  it('tags the Sentry report with the area, modules by default', () => {
    const error = pgError('57014', 'canceling statement due to statement timeout')
    moduleErrorMessage(error, FALLBACK)
    expect(mocks.captureException).toHaveBeenLastCalledWith(expect.any(Error), { tags: { area: 'modules', code: '57014' } })
    moduleErrorMessage(error, FALLBACK, 'settings')
    expect(mocks.captureException).toHaveBeenLastCalledWith(expect.any(Error), { tags: { area: 'settings', code: '57014' } })
  })

  // PostgreSQL's details and hint can hold row values (« Failing row contains (…) »).
  it('never sends the raw error, nor its details or hint, to Sentry', () => {
    const error = {
      code: '23502',
      message: 'null value in column "transit_number" violates not-null constraint',
      details: 'Failing row contains (815, null, 1234567).',
      hint: 'Check 1234567.',
    }
    moduleErrorMessage(error, FALLBACK, 'settings')
    const [sent, context] = mocks.captureException.mock.lastCall ?? []
    expect(sent).not.toBe(error)
    expect(sent).toBeInstanceOf(Error)
    expect(sent).not.toHaveProperty('details')
    expect(sent).not.toHaveProperty('hint')
    expect(JSON.stringify([sent, (sent as Error).message, (sent as Error).stack, context])).not.toContain('1234567')
    expect(reported().message).toBe(error.message)
  })

  it('falls back for network errors (empty code), reported as unknown', () => {
    expect(moduleErrorMessage(pgError('', 'TypeError: Failed to fetch'), FALLBACK)).toBe(FALLBACK)
    expect(reported().name).toBe('RpcError unknown')
    expect(mocks.captureException).toHaveBeenLastCalledWith(expect.any(Error), { tags: { area: 'modules', code: 'unknown' } })
  })

  it.each([[null], [undefined], ['boom'], [new Error('boom')]])('falls back for a non-database value (%s)', (value) => {
    expect(moduleErrorMessage(value, FALLBACK)).toBe(FALLBACK)
    expect(reported()).toBeInstanceOf(Error)
    expect(reported()).not.toBe(value)
  })
})

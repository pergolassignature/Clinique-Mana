import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { userAdminErrorMessage } from './hooks'

const mocks = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/react', () => mocks)
vi.mock('@/core/supabase/client', () => ({ supabase: {} }))

afterEach(() => vi.clearAllMocks())

describe('userAdminErrorMessage', () => {
  it('says an expired session (401 unauthenticated) in French, without a report', () => {
    expect(userAdminErrorMessage(new FunctionCallError('unauthenticated', 401, 'Invalid or expired token'))).toBe(
      t('settings.users.invite.errors.unauthenticated'),
    )
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('gives a 429 its delay and an unreachable function its text, without a report', () => {
    expect(userAdminErrorMessage(new FunctionCallError('rate_limited', 429, 'Too many attempts', {}, 2700))).toBe(
      `${t('settings.users.invite.errors.rateLimited')} Réessayez dans environ 45 minutes.`,
    )
    expect(userAdminErrorMessage(new FunctionCallError('network', 0, 'Function unreachable'))).toBe(t('settings.users.invite.errors.network'))
    expect(mocks.captureException).not.toHaveBeenCalled()
  })

  it('sends anything else through moduleErrorMessage (a P0001 as written; the rest generic and reported)', () => {
    expect(userAdminErrorMessage({ code: 'P0001', message: 'Cette personne a déjà un accès.' })).toBe('Cette personne a déjà un accès.')
    expect(userAdminErrorMessage(new FunctionCallError('internal', 500, 'Invite failed'))).toBe(t('common.errors.generic'))
    expect(mocks.captureException).toHaveBeenCalledOnce()
  })
})

// SUPABASE_ALLOWED: mocks the Supabase client so the real AuthProvider answers as GoTrue does.
// « Mon compte » with the real AuthProvider (decision #38): asking for an address that another
// account uses must look exactly like asking for a free one.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthApiError, type Session } from '@supabase/supabase-js'
import { t } from '@/i18n'
import { AuthProvider } from '@/core/auth/AuthProvider'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { renderWithContexts } from '@/test/contexts'
import { AccountPage } from './AccountPage'

const auth = vi.hoisted(() => ({ onAuthStateChange: vi.fn(), updateUser: vi.fn() }))
const mocks = vi.hoisted(() => ({
  fetchAuthUser: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  sentry: { captureException: vi.fn(), captureMessage: vi.fn() },
}))
vi.mock('@/core/supabase/client', () => ({ supabase: { auth }, AUTH_STORAGE_KEY: 'test-auth-key' }))
vi.mock('@/core/account/api', () => ({ updateDisplayName: vi.fn(), fetchAuthUser: mocks.fetchAuthUser }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => mocks.sentry)

afterEach(() => vi.resetAllMocks())

const user = { id: 'u1', email: 'admin@mana.test' }

/** Asks for `email` while GoTrue answers `answer`, then returns what the email card shows. */
async function requestChange(email: string, answer: { data: unknown; error: AuthApiError | null }, serverAfter: object) {
  auth.onAuthStateChange.mockImplementation((callback: (event: string, session: Session) => void) => {
    callback('INITIAL_SESSION', { access_token: 't1', user } as Session)
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  auth.updateUser.mockResolvedValue(answer)
  mocks.fetchAuthUser.mockResolvedValueOnce(user).mockResolvedValue(serverAfter)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <AuthProvider>
          <UnsavedChangesProvider>
            <AccountPage />
          </UnsavedChangesProvider>
        </AuthProvider>,
      )}
    </QueryClientProvider>,
  )
  const card = screen.getByRole('form', { name: t('account.email.title') })
  const field = within(card).getByLabelText(new RegExp(`^${t('account.email.new')}`))
  await userEvent.type(field, email)
  await userEvent.click(within(card).getByRole('button', { name: t('account.email.submit') }))
  await within(within(card).getByRole('status')).findByText(t('account.email.requested'))
  await waitFor(() => expect(mocks.fetchAuthUser).toHaveBeenCalledTimes(2))
  const shown = {
    // The email itself differs between the two runs: compare the card without it.
    text: card.textContent?.replaceAll(email, '<email>'),
    status: within(card).getByRole('status').textContent,
    fieldInvalid: field.getAttribute('aria-invalid'),
    fieldValue: (field as HTMLInputElement).value,
    alerts: within(card).queryAllByRole('alert').length,
    toasts: [mocks.toast.success.mock.calls, mocks.toast.error.mock.calls, mocks.toast.info.mock.calls],
  }
  view.unmount()
  vi.clearAllMocks()
  return shown
}

describe('« Courriel » with an address used by another account', () => {
  it('shows exactly what a real change shows: the neutral notice, no field error, nothing about the address', async () => {
    const free = await requestChange('libre@mana.test', { data: { user: { ...user, new_email: 'libre@mana.test' } }, error: null }, {
      ...user,
      new_email: 'libre@mana.test',
    })
    const taken = await requestChange(
      'adjointe@mana.test',
      { data: {}, error: new AuthApiError('A user with this email address has already been registered', 422, 'email_exists') },
      user,
    )

    expect(taken).toEqual(free)
    expect(taken.status).toBe(`${t('account.email.requestedTitle')}${t('account.email.requested')}`)
    expect(taken.fieldInvalid).not.toBe('true')
    expect(taken.fieldValue).toBe('')
    expect(taken.alerts).toBe(0)
    expect(taken.text).not.toMatch(/déjà utilisé|autre compte|en attente/i)
  })

  // GoTrue checks for a duplicate before its per-user throttle: within the window a free address
  // answers « throttled » and a taken one « exists ». Both must look like a success.
  it('looks the same within the email throttle window', async () => {
    const throttledFree = await requestChange(
      'libre@mana.test',
      { data: {}, error: new AuthApiError('For security purposes, you can only request this after 60 seconds.', 429, 'over_email_send_rate_limit') },
      user,
    )
    const taken = await requestChange(
      'adjointe@mana.test',
      { data: {}, error: new AuthApiError('A user with this email address has already been registered', 422, 'email_exists') },
      user,
    )
    expect(taken).toEqual(throttledFree)
  })
})

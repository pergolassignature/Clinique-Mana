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

type Answer = { data: { user?: object }; error: AuthApiError | null }

const taken: Answer = {
  data: {},
  error: new AuthApiError('A user with this email address has already been registered', 422, 'email_exists'),
}
const freeAnswer = (email: string): Answer => ({ data: { user: { ...user, new_email: email } }, error: null })
const outage: Answer = { data: {}, error: new AuthApiError('Error sending email change email', 500, 'unexpected_failure') }

/**
 * Asks for `email` once per answer while GoTrue answers them in turn, then returns what the email
 * card shows. `serverAfter` is the user GoTrue returns once a request has succeeded.
 */
async function requestChange(email: string, answers: Answer | Answer[], serverAfter: object) {
  const queue = Array.isArray(answers) ? [...answers] : [answers]
  let emit: ((event: string, session: Session) => void) | undefined
  auth.onAuthStateChange.mockImplementation((callback: (event: string, session: Session) => void) => {
    emit = callback
    callback('INITIAL_SESSION', { access_token: 't1', user } as Session)
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  // As auth-js does: on success, USER_UPDATED with the updated user, before updateUser resolves.
  auth.updateUser.mockImplementation(async () => {
    const answer = queue.shift()!
    if (!answer.error && answer.data.user) emit?.('USER_UPDATED', { access_token: 't1', user: answer.data.user } as Session)
    return answer
  })
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
  const attempts = queue.length
  for (let i = 0; i < attempts; i++) {
    const before = auth.updateUser.mock.calls.length
    await userEvent.clear(field)
    await userEvent.type(field, email)
    await userEvent.click(within(card).getByRole('button', { name: t('account.email.submit') }))
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledTimes(before + 1))
    await waitFor(() => expect(within(card).getByRole('button', { name: t('account.email.submit') })).toBeEnabled())
  }
  // The refetch after a success (neutral or not) has landed.
  await waitFor(() => expect(mocks.fetchAuthUser).toHaveBeenCalledTimes(2))
  const shown = {
    // The email itself differs between the two runs: compare the card without it.
    text: card.textContent?.replaceAll(email, '<email>'),
    status: within(card).getByRole('status').textContent,
    fieldInvalid: field.getAttribute('aria-invalid'),
    fieldValue: (field as HTMLInputElement).value.replaceAll(email, '<email>'),
    alerts: within(card).queryAllByRole('alert').length,
    toasts: [mocks.toast.success.mock.calls, mocks.toast.error.mock.calls, mocks.toast.info.mock.calls],
  }
  view.unmount()
  vi.clearAllMocks()
  return shown
}

describe('« Courriel » with an address used by another account', () => {
  it('shows exactly what a real change shows: the neutral notice, no field error, nothing about the address', async () => {
    const free = await requestChange('libre@mana.test', freeAnswer('libre@mana.test'), { ...user, new_email: 'libre@mana.test' })
    const shownTaken = await requestChange('adjointe@mana.test', taken, user)

    expect(shownTaken).toEqual(free)
    expect(shownTaken.status).toBe(`${t('account.email.requestedTitle')}${t('account.email.requested')}`)
    expect(shownTaken.fieldInvalid).not.toBe('true')
    expect(shownTaken.fieldValue).toBe('')
    expect(shownTaken.alerts).toBe(0)
    expect(shownTaken.text).not.toMatch(/déjà utilisé|autre compte|en attente/i)
  })

  // GoTrue checks for a duplicate before its per-user throttle: within the window a free address
  // answers « throttled » and a taken one « exists ». Both must look like a success.
  it('looks the same within the email throttle window', async () => {
    const throttledFree = await requestChange(
      'libre@mana.test',
      { data: {}, error: new AuthApiError('For security purposes, you can only request this after 60 seconds.', 429, 'over_email_send_rate_limit') },
      user,
    )
    const shownTaken = await requestChange('adjointe@mana.test', taken, user)
    expect(shownTaken).toEqual(throttledFree)
  })

  // A later attempt that fails replaces the earlier notice with its error, and never lets the
  // pending address (new_email, recorded only for a real change) show through.
  it('after a request, a failed retry shows only its error, the same for a free and a taken address', async () => {
    const free = await requestChange('libre@mana.test', [freeAnswer('libre@mana.test'), outage], {
      ...user,
      new_email: 'libre@mana.test',
    })
    const shownTaken = await requestChange('adjointe@mana.test', [taken, outage], user)

    expect(shownTaken).toEqual(free)
    expect(shownTaken.alerts).toBe(1)
    expect(shownTaken.text).toContain(t('auth.errors.unknown'))
    expect(shownTaken.status).toBe('')
    expect(shownTaken.text).not.toContain(t('account.email.requestedTitle'))
    expect(shownTaken.text).not.toMatch(/en attente/i)
  })
})

import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import type { CalendarSetup } from '../api/calendar'
import { MyGoogleCalendarPage } from './MyGoogleCalendarPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchMyCalendarSetup: vi.fn(),
    finishGoogleCalendarConnect: vi.fn(),
    startGoogleCalendarConnect: vi.fn(),
    syncGoogleCalendar: vi.fn(),
    disconnectGoogleCalendar: vi.fn(),
  },
  leaveFor: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/calendar', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/calendar')>()), ...mocks.api }))
vi.mock('../lib/leave-for', () => ({ leaveFor: mocks.leaveFor }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.appointments.calendar'
const PRO = 'c0000000-0000-0000-0000-000000000001'
const setup = (over: Partial<CalendarSetup> = {}): CalendarSetup => ({
  professional_id: PRO,
  state: null,
  account_email: null,
  connected_at: null,
  reconnect_reason: null,
  last_synced_at: null,
  last_sync_error: null,
  busy_count: null,
  ...over,
})
const connected = (over: Partial<CalendarSetup> = {}) =>
  setup({
    state: 'connected',
    account_email: 'pro@gmail.test',
    connected_at: '2026-10-13T15:00:00Z',
    last_synced_at: '2026-10-13T15:05:00Z',
    busy_count: 3,
    ...over,
  })

beforeEach(() => mocks.api.fetchMyCalendarSetup.mockResolvedValue(setup()))
afterEach(() => vi.clearAllMocks())

function renderAt(path = '/mon-agenda/agenda-google') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {renderWithContexts(
          <Routes>
            <Route path="/mon-agenda/agenda-google" element={<MyGoogleCalendarPage />} />
          </Routes>,
          { path },
        )}
      </QueryClientProvider>
    </StrictMode>,
  )
}

describe('MyGoogleCalendarPage (R6)', () => {
  it('not connected: says what is read (never a title) and « Connecter mon agenda Google » leaves for Google', async () => {
    mocks.api.startGoogleCalendarConnect.mockResolvedValue('https://accounts.google.com/o/oauth2/v2/auth?client_id=x')
    renderAt()
    expect(await screen.findByText(t(`${C}.notConnected`))).toBeInTheDocument()
    expect(screen.getByText(t(`${C}.page.description`))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.connect`) }))
    await waitFor(() => expect(mocks.leaveFor).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?client_id=x'))
  })

  it('the clinic has not set its Google application: said in French, nothing left for', async () => {
    mocks.api.startGoogleCalendarConnect.mockRejectedValue(new FunctionCallError('not_configured', 503, 'x'))
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: t(`${C}.connect`) }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t(`${C}.errors.notConfigured`)))
    expect(mocks.leaveFor).not.toHaveBeenCalled()
  })

  it('back from Google: posts the code and state once (even under StrictMode), says it', async () => {
    mocks.api.finishGoogleCalendarConnect.mockResolvedValue({ email: 'pro@gmail.test', busy: 2 })
    renderAt('/mon-agenda/agenda-google?code=abc&state=s.t')
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.connectedToast`, { email: 'pro@gmail.test' })))
    expect(mocks.api.finishGoogleCalendarConnect).toHaveBeenCalledExactlyOnceWith('abc', 's.t')
  })

  it('a declined consent posts nothing and says so', async () => {
    renderAt('/mon-agenda/agenda-google?error=access_denied')
    expect(await screen.findByText(t(`${C}.declined`))).toBeInTheDocument()
    expect(mocks.api.finishGoogleCalendarConnect).not.toHaveBeenCalled()
  })

  it('the free/busy box unticked: the refusal as written', async () => {
    const refusal = new FunctionCallError('invalid_request', 400, 'La permission de voir vos disponibilités n’a pas été accordée.', { refusal: true })
    mocks.api.finishGoogleCalendarConnect.mockRejectedValue(refusal)
    renderAt('/mon-agenda/agenda-google?code=abc&state=s.t')
    expect(await screen.findByText('La permission de voir vos disponibilités n’a pas été accordée.')).toBeInTheDocument()
  })

  it('connected: the account, the last read and its count, « Synchroniser », « Déconnecter » confirmed', async () => {
    mocks.api.fetchMyCalendarSetup.mockResolvedValue(connected())
    mocks.api.syncGoogleCalendar.mockResolvedValue('synced')
    mocks.api.disconnectGoogleCalendar.mockResolvedValue(undefined)
    renderAt()
    expect(await screen.findByText(t(`${C}.connected`))).toBeInTheDocument()
    expect(screen.getByText(/^Compte pro@gmail\.test, connecté le/)).toBeInTheDocument()
    expect(screen.getByText(/^Lu le .+ : 3 moments occupés dans les 62 prochains jours\.$/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${C}.connect`) })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.sync`) }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.synced`)))
    await userEvent.click(screen.getByRole('button', { name: t(`${C}.disconnect`) }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${C}.disconnectConfirm.action`) }))
    await waitFor(() => expect(mocks.api.disconnectGoogleCalendar).toHaveBeenCalledTimes(1))
  })

  it('a failed last read: said, the times kept', async () => {
    mocks.api.fetchMyCalendarSetup.mockResolvedValue(connected({ last_sync_error: 'provider_error' }))
    renderAt()
    expect(await screen.findByText(/^La dernière lecture a échoué\./)).toBeInTheDocument()
  })

  it('to reconnect (the permission removed): why, and « Reconnecter mon agenda Google »', async () => {
    mocks.api.fetchMyCalendarSetup.mockResolvedValue(connected({ state: 'needs_reconnect', reconnect_reason: 'scope_missing' }))
    renderAt()
    expect(await screen.findByText(new RegExp(`^${t(`${C}.reconnectScope`)}`))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t(`${C}.reconnect`) })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${C}.sync`) })).not.toBeInTheDocument()
  })

  it('an account without a professional file: said plainly', async () => {
    mocks.api.fetchMyCalendarSetup.mockResolvedValue(null)
    renderAt()
    expect(await screen.findByText(t(`${C}.page.notProfessionalTitle`))).toBeInTheDocument()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import type { AgendaAppointment } from '../api/parse'
import { AppointmentMessages } from './AppointmentMessages'

const mocks = vi.hoisted(() => ({
  api: { fetchAppointmentMessages: vi.fn(), resendAppointmentNotification: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/messages', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))

const M = 'modules.appointments.editor.messages'
const COMING = new Date(Date.now() + 10 * 86_400_000).toISOString()

/** Only what the tab reads of the appointment. */
const appointment = (overrides: Partial<AgendaAppointment> = {}) => ({ id: 'a1', startsAt: COMING, state: 'booked', ...overrides }) as AgendaAppointment

function open(a: AgendaAppointment, role: FixtureRole = 'counselor') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{renderWithContexts(<AppointmentMessages appointment={a} />, { access: { access: accessForRole(role) } })}</QueryClientProvider>)
}

afterEach(() => vi.clearAllMocks())

describe('AppointmentMessages', () => {
  it('lists each message: its kind, channel, recipient and state in words', async () => {
    mocks.api.fetchAppointmentMessages.mockResolvedValue([
      { id: 'm2', kind: 'reminder', channel: 'sms', recipientName: 'Camille Essai', status: 'skipped', skipReason: 'no_consent', attempts: 0, createdAt: '2026-10-12T14:00:00Z', sentAt: null },
      { id: 'm1', kind: 'confirmation', channel: 'email', recipientName: 'Camille Essai', status: 'sent', skipReason: null, attempts: 1, createdAt: '2026-10-10T14:00:00Z', sentAt: '2026-10-10T14:05:00Z' },
    ])
    open(appointment())
    const list = await screen.findByRole('list', { name: t(`${M}.label`) })
    expect(list).toHaveTextContent(t(`${M}.kind.reminder`))
    expect(list).toHaveTextContent(t(`${M}.status.skipped`, { reason: t(`${M}.skip.no_consent`) }))
    expect(list).toHaveTextContent(t(`${M}.kind.confirmation`))
    expect(list).toHaveTextContent('Courriel · Camille Essai')
  })

  it('« Renvoyer la notification »: says how many went, or that nobody can be reached', async () => {
    const user = userEvent.setup()
    mocks.api.fetchAppointmentMessages.mockResolvedValue([])
    mocks.api.resendAppointmentNotification.mockResolvedValueOnce(2).mockResolvedValueOnce(0)
    open(appointment())
    expect(await screen.findByText(t(`${M}.empty`))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${M}.resend`) }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${M}.resent`, { count: '2' })))
    await user.click(screen.getByRole('button', { name: t(`${M}.resend`) }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t(`${M}.nobody`)))
    expect(mocks.api.resendAppointmentNotification).toHaveBeenCalledWith('a1')
  })

  it('no « Renvoyer » for a past appointment', async () => {
    mocks.api.fetchAppointmentMessages.mockResolvedValue([])
    open(appointment({ startsAt: '2026-01-05T14:00:00Z', state: 'completed' }))
    expect(await screen.findByText(t(`${M}.empty`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${M}.resend`) })).not.toBeInTheDocument()
  })

  it('… nor for a professional', async () => {
    mocks.api.fetchAppointmentMessages.mockResolvedValue([])
    open(appointment(), 'provider')
    expect(await screen.findByText(t(`${M}.empty`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${M}.resend`) })).not.toBeInTheDocument()
  })
})

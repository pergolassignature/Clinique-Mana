import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import { VideoSection } from './VideoSection'

const mocks = vi.hoisted(() => ({ fetchAppointmentVideo: vi.fn(), retryAppointmentVideo: vi.fn() }))
vi.mock('../api/video', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks }))
vi.mock('@/shared/ui/sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const V = 'modules.appointments.editor.video'

function open() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{renderWithContexts(<VideoSection appointmentId="a1" />, { access: { access: accessForRole('counselor') } })}</QueryClientProvider>)
}

afterEach(() => vi.clearAllMocks())

describe('VideoSection', () => {
  it('a ready link: « Démarrer » opens it in a new tab', async () => {
    mocks.fetchAppointmentVideo.mockResolvedValue({ url: 'https://zoom.us/j/123', source: 'zoom', status: 'ready' })
    open()
    const start = await screen.findByRole('link', { name: t(`${V}.start`) })
    expect(start).toHaveAttribute('href', 'https://zoom.us/j/123')
    expect(start).toHaveAttribute('target', '_blank')
    expect(screen.getByText(t(`${V}.zoom`))).toBeInTheDocument()
  })

  it('a failed meeting: « Réessayer »', async () => {
    const user = userEvent.setup()
    mocks.fetchAppointmentVideo.mockResolvedValue({ url: null, source: 'zoom', status: 'failed' })
    mocks.retryAppointmentVideo.mockResolvedValue(undefined)
    open()
    await user.click(await screen.findByRole('button', { name: t(`${V}.retry`) }))
    expect(mocks.retryAppointmentVideo).toHaveBeenCalledWith('a1')
  })

  it('no link at all: says the professional has none', async () => {
    mocks.fetchAppointmentVideo.mockResolvedValue({ url: null, source: null, status: 'none' })
    open()
    expect(await screen.findByText(t(`${V}.none`))).toBeInTheDocument()
  })
})

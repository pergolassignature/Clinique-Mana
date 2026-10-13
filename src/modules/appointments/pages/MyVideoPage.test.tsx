import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import type { VideoSetup } from '../api/video'
import { MyVideoPage } from './MyVideoPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchMyVideoSetup: vi.fn(),
    finishZoomConnect: vi.fn(),
    startZoomConnect: vi.fn(),
    disconnectZoom: vi.fn(),
    setProfessionalVideoLink: vi.fn(),
  },
  leaveFor: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/video', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/video')>()), ...mocks.api }))
vi.mock('../lib/leave-for', () => ({ leaveFor: mocks.leaveFor }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const V = 'modules.appointments.video'
const PRO = 'c0000000-0000-0000-0000-000000000001'
const setup = (over: Partial<VideoSetup> = {}): VideoSetup => ({
  professional_id: PRO,
  zoom_state: null,
  zoom_email: null,
  zoom_connected_at: null,
  zoom_reconnect_reason: null,
  fixed_url: null,
  ...over,
})

beforeEach(() => mocks.api.fetchMyVideoSetup.mockResolvedValue(setup()))
afterEach(() => vi.clearAllMocks())

function renderAt(path = '/mon-agenda/videoconference') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {renderWithContexts(
          <Routes>
            <Route path="/mon-agenda/videoconference" element={<MyVideoPage />} />
          </Routes>,
          { path },
        )}
      </QueryClientProvider>
    </StrictMode>,
  )
}

describe('MyVideoPage (RZ)', () => {
  it('not connected: « Connecter mon Zoom » leaves for Zoom\'s consent page', async () => {
    mocks.api.startZoomConnect.mockResolvedValue('https://zoom.us/oauth/authorize?client_id=x')
    renderAt()
    expect(await screen.findByText(t(`${V}.zoom.notConnected`))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${V}.zoom.connect`) }))
    await waitFor(() => expect(mocks.leaveFor).toHaveBeenCalledWith('https://zoom.us/oauth/authorize?client_id=x'))
  })

  it('the clinic has not set Zoom: said in French, nothing left for', async () => {
    mocks.api.startZoomConnect.mockRejectedValue(new FunctionCallError('not_configured', 503, 'x'))
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: t(`${V}.zoom.connect`) }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t(`${V}.errors.notConfigured`)))
    expect(mocks.leaveFor).not.toHaveBeenCalled()
  })

  it('back from Zoom: posts the code and state once (even under StrictMode), says it, empties the address', async () => {
    mocks.api.finishZoomConnect.mockResolvedValue('pro@zoom.test')
    renderAt('/mon-agenda/videoconference?code=abc&state=s.t')
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${V}.zoom.connectedToast`, { email: 'pro@zoom.test' })))
    expect(mocks.api.finishZoomConnect).toHaveBeenCalledExactlyOnceWith('abc', 's.t')
  })

  it('a declined consent posts nothing and says so', async () => {
    renderAt('/mon-agenda/videoconference?error=access_denied')
    expect(await screen.findByText(t(`${V}.zoom.declined`))).toBeInTheDocument()
    expect(mocks.api.finishZoomConnect).not.toHaveBeenCalled()
  })

  it('a spent return says why', async () => {
    mocks.api.finishZoomConnect.mockRejectedValue(new FunctionCallError('link_used', 410, 'x'))
    renderAt('/mon-agenda/videoconference?code=abc&state=s.t')
    expect(await screen.findByText(t(`${V}.errors.linkUsed`))).toBeInTheDocument()
  })

  it('connected: who and since when, « Déconnecter » confirmed', async () => {
    mocks.api.fetchMyVideoSetup.mockResolvedValue(
      setup({ zoom_state: 'connected', zoom_email: 'pro@zoom.test', zoom_connected_at: '2026-10-13T15:00:00Z' }),
    )
    mocks.api.disconnectZoom.mockResolvedValue(undefined)
    renderAt()
    expect(await screen.findByText(t(`${V}.readiness.zoom`))).toBeInTheDocument()
    expect(screen.getByText(/^Compte pro@zoom\.test, connecté le/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${V}.zoom.connect`) })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${V}.zoom.disconnect`) }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${V}.zoom.disconnectConfirm.action`) }))
    await waitFor(() => expect(mocks.api.disconnectZoom).toHaveBeenCalledTimes(1))
  })

  it('to reconnect: the notice and « Reconnecter mon Zoom »', async () => {
    mocks.api.fetchMyVideoSetup.mockResolvedValue(setup({ zoom_state: 'needs_reconnect', zoom_reconnect_reason: 'invalid_grant' }))
    renderAt()
    expect(await screen.findByText(t(`${V}.zoom.reconnectNotice`))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t(`${V}.zoom.reconnect`) })).toBeInTheDocument()
  })

  it('the fixed link: checked before sending, then saved trimmed', async () => {
    mocks.api.setProfessionalVideoLink.mockResolvedValue(undefined)
    renderAt()
    const field = await screen.findByRole('textbox', { name: new RegExp(`^${t(`${V}.fixed.label`)}`) })
    await userEvent.type(field, 'meet.google.com/abc')
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    expect(await screen.findByText(t(`${V}.fixed.invalid`))).toBeInTheDocument()
    expect(mocks.api.setProfessionalVideoLink).not.toHaveBeenCalled()
    await userEvent.clear(field)
    await userEvent.type(field, ' https://meet.google.com/abc-defg-hij ')
    await userEvent.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.setProfessionalVideoLink).toHaveBeenCalledExactlyOnceWith(PRO, 'https://meet.google.com/abc-defg-hij'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${V}.fixed.saved`))
  })

  it('an account without a professional file: said plainly', async () => {
    mocks.api.fetchMyVideoSetup.mockResolvedValue(null)
    renderAt()
    expect(await screen.findByText(t(`${V}.page.notProfessionalTitle`))).toBeInTheDocument()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import { ManageAppointmentPage } from './ManageAppointmentPage'

const mocks = vi.hoisted(() => ({ resolveManageLink: vi.fn(), manageByLink: vi.fn() }))
vi.mock('../../api/messages', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.appointments.manage'
const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const DISPLAY = {
  clinic_name: 'Clinique MANA',
  language: 'fr',
  when: 'lundi 19 octobre à 10 h 00',
  professional_name: 'Félix Martin',
  mode: 'phone',
  late: false,
  notice_hours: 24,
  business_hours: true,
}

function open(hash = `#t=${TOKEN}`) {
  window.history.replaceState(null, '', `/rendez-vous/gerer${hash}`)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/rendez-vous/gerer" element={<ManageAppointmentPage />} />
        </Routes>,
        { path: `/rendez-vous/gerer${hash}`, access: { status: 'idle', access: null } },
      )}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.resolveManageLink.mockResolvedValue(DISPLAY)
  mocks.manageByLink.mockResolvedValue({ state: 'cancelled', late: false })
})
afterEach(() => vi.clearAllMocks())

describe('ManageAppointmentPage', () => {
  it('the token leaves the address; the appointment and the clinic’s notice shown; « Annuler » asks once more, then cancels once', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByText(t(`${C}.bodyPhone`, { clinic: 'Clinique MANA', when: 'lundi 19 octobre à 10 h 00', professional: 'Félix Martin' }))).toBeInTheDocument()
    expect(window.location.hash).toBe('')
    expect(mocks.resolveManageLink).toHaveBeenCalledExactlyOnceWith(TOKEN)
    expect(screen.getByText(t(`${C}.onTimeBusiness`, { hours: '24' }))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${C}.cancel`) }))
    expect(screen.getByText(t(`${C}.cancelConfirm`))).toHaveFocus()
    expect(mocks.manageByLink).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: t(`${C}.cancelYes`) }))
    await waitFor(() => expect(mocks.manageByLink).toHaveBeenCalledExactlyOnceWith(TOKEN, 'cancel'))
    expect(await screen.findByText(t(`${C}.cancelled`))).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('late: the page warns that it may be charged, and says so once cancelled', async () => {
    const user = userEvent.setup()
    mocks.resolveManageLink.mockResolvedValue({ ...DISPLAY, late: true })
    mocks.manageByLink.mockResolvedValue({ state: 'cancelled', late: true })
    open()
    expect(await screen.findByText(t(`${C}.lateBusiness`, { hours: '24' }))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${C}.cancel`) }))
    await user.click(screen.getByRole('button', { name: t(`${C}.cancelYes`) }))
    expect(await screen.findByText(t(`${C}.cancelledLate`))).toBeInTheDocument()
  })

  it('calendar hours, or no policy: the notice in its words, or none', async () => {
    mocks.resolveManageLink.mockResolvedValue({ ...DISPLAY, late: true, business_hours: false })
    const first = open()
    expect(await screen.findByText(t(`${C}.lateCalendar`, { hours: '24' }))).toBeInTheDocument()
    first.unmount()
    mocks.resolveManageLink.mockResolvedValue({ ...DISPLAY, late: null, notice_hours: null })
    open()
    await screen.findByRole('button', { name: t(`${C}.cancel`) })
    expect(screen.queryByText(t(`${C}.onTimeBusiness`, { hours: '24' }))).not.toBeInTheDocument()
  })

  it('« Demander un changement »: asks once more, « Retour » goes back, then the request is sent', async () => {
    const user = userEvent.setup()
    mocks.manageByLink.mockResolvedValue({ state: 'requested' })
    open()
    await user.click(await screen.findByRole('button', { name: t(`${C}.change`) }))
    expect(screen.getByText(t(`${C}.changeConfirm`))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${C}.back`) }))
    expect(screen.queryByText(t(`${C}.changeConfirm`))).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${C}.change`) }))
    await user.click(screen.getByRole('button', { name: t(`${C}.changeYes`) }))
    await waitFor(() => expect(mocks.manageByLink).toHaveBeenCalledExactlyOnceWith(TOKEN, 'change_request'))
    expect(await screen.findByText(t(`${C}.requested`))).toBeInTheDocument()
  })

  it('a malformed, used or expired link: « ne peut plus être utilisé »', async () => {
    open('#t=court')
    expect(await screen.findByText(t(`${C}.invalid`))).toBeInTheDocument()
    expect(mocks.resolveManageLink).not.toHaveBeenCalled()
  })

  it('a link that is gone when acting; another failure lets the client try again', async () => {
    const user = userEvent.setup()
    mocks.manageByLink.mockRejectedValueOnce(new FunctionCallError('internal', 500, 'boom'))
    mocks.manageByLink.mockRejectedValueOnce(new FunctionCallError('link_used', 410, 'gone'))
    open()
    await user.click(await screen.findByRole('button', { name: t(`${C}.cancel`) }))
    await user.click(screen.getByRole('button', { name: t(`${C}.cancelYes`) }))
    expect(await screen.findByText(t(`${C}.error`))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${C}.cancelYes`) }))
    expect(await screen.findByText(t(`${C}.invalid`))).toBeInTheDocument()
  })
})

describe('ManageAppointmentPage in English', () => {
  it('an English recipient: the page in English (the moment comes written in it)', async () => {
    mocks.resolveManageLink.mockResolvedValue({ ...DISPLAY, language: 'en', when: 'Monday, October 19 at 10:00 a.m.', mode: 'video' })
    open()
    expect(
      await screen.findByText(
        t('modules.appointments.manageEn.bodyVideo', { clinic: 'Clinique MANA', when: 'Monday, October 19 at 10:00 a.m.', professional: 'Félix Martin' }),
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('modules.appointments.manageEn.cancel') })).toBeInTheDocument()
  })
})

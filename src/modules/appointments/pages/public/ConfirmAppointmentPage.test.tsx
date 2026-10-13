import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import { ConfirmAppointmentPage } from './ConfirmAppointmentPage'

const mocks = vi.hoisted(() => ({ resolveConfirmLink: vi.fn(), confirmByLink: vi.fn() }))
vi.mock('../../api/messages', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.appointments.confirm'
const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
const DISPLAY = { clinic_name: 'Clinique MANA', language: 'fr', when: 'lundi 19 octobre à 10 h 00', professional_name: 'Félix Martin', mode: 'video', confirmed: false }

function open(hash = `#t=${TOKEN}`) {
  window.history.replaceState(null, '', `/rendez-vous/confirmer${hash}`)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/rendez-vous/confirmer" element={<ConfirmAppointmentPage />} />
        </Routes>,
        { path: `/rendez-vous/confirmer${hash}`, access: { status: 'idle', access: null } },
      )}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.resolveConfirmLink.mockResolvedValue(DISPLAY)
  mocks.confirmByLink.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

describe('ConfirmAppointmentPage', () => {
  it('the token leaves the address; the appointment shown, « Confirmer ma présence » confirms once', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByText(t(`${C}.bodyVideo`, { clinic: 'Clinique MANA', when: 'lundi 19 octobre à 10 h 00', professional: 'Félix Martin' }))).toBeInTheDocument()
    expect(window.location.hash).toBe('')
    expect(mocks.resolveConfirmLink).toHaveBeenCalledExactlyOnceWith(TOKEN)
    await user.click(screen.getByRole('button', { name: t(`${C}.button`) }))
    await waitFor(() => expect(mocks.confirmByLink).toHaveBeenCalledExactlyOnceWith(TOKEN))
    expect(await screen.findByText(t(`${C}.done`))).toBeInTheDocument()
  })

  it('already confirmed: said so, no button', async () => {
    mocks.resolveConfirmLink.mockResolvedValue({ ...DISPLAY, confirmed: true })
    open()
    expect(await screen.findByText(t(`${C}.already`))).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('a malformed, used or expired link: « ne peut plus être utilisé »', async () => {
    open('#t=court')
    expect(await screen.findByText(t(`${C}.invalid`))).toBeInTheDocument()
    expect(mocks.resolveConfirmLink).not.toHaveBeenCalled()
  })

  it('a link that is gone when confirming', async () => {
    const user = userEvent.setup()
    mocks.confirmByLink.mockRejectedValue(new FunctionCallError('link_invalid', 410, 'gone'))
    open()
    await user.click(await screen.findByRole('button', { name: t(`${C}.button`) }))
    expect(await screen.findByText(t(`${C}.invalid`))).toBeInTheDocument()
  })
})

describe('ConfirmAppointmentPage in English', () => {
  it('an English recipient: the page in English (the moment comes written in it)', async () => {
    mocks.resolveConfirmLink.mockResolvedValue({ ...DISPLAY, language: 'en', when: 'Monday, October 19 at 10:00 a.m.' })
    open()
    expect(
      await screen.findByText(
        t('modules.appointments.confirmEn.bodyVideo', { clinic: 'Clinique MANA', when: 'Monday, October 19 at 10:00 a.m.', professional: 'Félix Martin' }),
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('modules.appointments.confirmEn.button') })).toBeInTheDocument()
  })
})

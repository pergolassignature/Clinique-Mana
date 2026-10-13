import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import { WaitlistAnswerPage } from './WaitlistAnswerPage'

const mocks = vi.hoisted(() => ({ resolveFollowupLink: vi.fn(), answerFollowup: vi.fn() }))
vi.mock('../../api/waitlist', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const A = 'modules.demandes.waitlist.answer'
const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'

function open(hash = `#t=${TOKEN}`) {
  window.history.replaceState(null, '', `/liste-attente/reponse${hash}`)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/liste-attente/reponse" element={<WaitlistAnswerPage />} />
        </Routes>,
        { path: `/liste-attente/reponse${hash}`, access: { status: 'idle', access: null } },
      )}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.resolveFollowupLink.mockResolvedValue({ clinic_name: 'Clinique MANA', list_name: 'Psychologie' })
  mocks.answerFollowup.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

describe('WaitlistAnswerPage', () => {
  it('the token leaves the address; « Oui » keeps the person on the list', async () => {
    const user = userEvent.setup()
    open()
    expect(await screen.findByText(t(`${A}.body`, { clinic: 'Clinique MANA', list: 'Psychologie' }))).toBeInTheDocument()
    expect(window.location.hash).toBe('')
    expect(mocks.resolveFollowupLink).toHaveBeenCalledExactlyOnceWith(TOKEN)
    await user.click(screen.getByRole('button', { name: t(`${A}.stay`) }))
    await waitFor(() => expect(mocks.answerFollowup).toHaveBeenCalledExactlyOnceWith(TOKEN, 'stay'))
    expect(await screen.findByText(t(`${A}.stayBody`))).toBeInTheDocument()
  })

  it('« Non » takes the person off the list', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: t(`${A}.leave`) }))
    await waitFor(() => expect(mocks.answerFollowup).toHaveBeenCalledWith(TOKEN, 'leave'))
    expect(await screen.findByText(t(`${A}.leaveBody`))).toBeInTheDocument()
  })

  it('a malformed, used or expired link: « ne peut plus être utilisé »', async () => {
    open('#t=court')
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${A}.invalid`))
    expect(mocks.resolveFollowupLink).not.toHaveBeenCalled()
  })

  it('answered meanwhile (the link spent): the same sentence', async () => {
    const user = userEvent.setup()
    mocks.answerFollowup.mockRejectedValue(new FunctionCallError('link_invalid', 410, 'Gone'))
    open()
    await user.click(await screen.findByRole('button', { name: t(`${A}.stay`) }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${A}.invalid`))
  })
})

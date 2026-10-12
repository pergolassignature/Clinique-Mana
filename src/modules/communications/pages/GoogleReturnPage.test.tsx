import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import { GoogleReturnPage } from './GoogleReturnPage'

const mocks = vi.hoisted(() => ({
  api: { finishGmailConnect: vi.fn(), syncMailConnection: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/mailboxes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/mailboxes')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const R = 'modules.communications.googleReturn'

afterEach(() => vi.clearAllMocks())

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {renderWithContexts(
          <Routes>
            <Route path="/courriels/retour-google" element={<GoogleReturnPage />} />
            <Route path="/parametres/courriels-gmail" element={<p>GMAIL SETTINGS</p>} />
          </Routes>,
          { path },
        )}
      </QueryClientProvider>
    </StrictMode>,
  )
}

describe('GoogleReturnPage', () => {
  it('posts the code and state once (even under StrictMode), syncs, then goes back to the settings', async () => {
    mocks.api.finishGmailConnect.mockResolvedValue({ connection_id: 'c1', email_address: 'info@clinique.test' })
    mocks.api.syncMailConnection.mockResolvedValue({ outcome: 'synced', messages: 12, attachments: 1, initial_pending: false })
    renderAt('/courriels/retour-google?code=4%2Fabc&state=s.t.u&scope=x')
    expect(screen.getByText(t(`${R}.pendingTitle`))).toBeInTheDocument()
    expect(await screen.findByText('GMAIL SETTINGS')).toBeInTheDocument()
    expect(mocks.api.finishGmailConnect).toHaveBeenCalledExactlyOnceWith('4/abc', 's.t.u')
    expect(mocks.api.syncMailConnection).toHaveBeenCalledExactlyOnceWith('c1')
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${R}.connected`, { email: 'info@clinique.test' }))
  })

  it('a refused return says why in French and offers the way back', async () => {
    mocks.api.finishGmailConnect.mockRejectedValue(new FunctionCallError('link_expired', 410, 'State expired'))
    renderAt('/courriels/retour-google?code=x&state=y')
    expect(await screen.findByText(t('modules.communications.errors.linkExpired'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${R}.back`) })).toHaveAttribute('href', '/parametres/courriels-gmail')
    expect(mocks.api.syncMailConnection).not.toHaveBeenCalled()
  })

  it('a consent declined at Google posts nothing', async () => {
    renderAt('/courriels/retour-google?error=access_denied&state=y')
    expect(await screen.findByText(t(`${R}.declinedTitle`))).toBeInTheDocument()
    await waitFor(() => expect(mocks.api.finishGmailConnect).not.toHaveBeenCalled())
  })

  it('a return without its code posts nothing', () => {
    renderAt('/courriels/retour-google')
    expect(screen.getByText(t(`${R}.missing`))).toBeInTheDocument()
    expect(mocks.api.finishGmailConnect).not.toHaveBeenCalled()
  })
})

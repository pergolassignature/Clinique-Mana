import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { setClinicTimezone } from '@/shared/lib/timezone'
import { renderWithContexts } from '@/test/contexts'
import { ClientDemandesPanel } from './ClientDemandesPanel'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../api/demandes', async (o) => ({ ...(await o<typeof import('../api/demandes')>()), fetchClientDemandes: mocks.fetch }))

const C = 'modules.demandes.clientPanel'

beforeAll(() => setClinicTimezone('America/Toronto'))
afterEach(() => vi.clearAllMocks())

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="clients/:id/:onglet" element={<ClientDemandesPanel />} />
        </Routes>,
        { path: '/clients/c1/demandes' },
      )}
    </QueryClientProvider>,
  )
}

describe('Clients\' tab « Demandes » (A-1, D-46)', () => {
  it('her requests and those she is part of, each to its record, with the state and the matched professional', async () => {
    mocks.fetch.mockResolvedValue([
      { id: 'd2', reference: 'DEM-2026-0002', received_at: '2026-10-10T14:00:00Z', state: 'matched', closed_reason: null, beneficiary: 'couple', role: 'participant', matched_professional_name: 'Pro Un' },
      { id: 'd1', reference: 'DEM-2026-0001', received_at: '2026-09-10T14:00:00Z', state: 'closed', closed_reason: 'withdrew', beneficiary: 'self', role: 'file', matched_professional_name: null },
    ])
    renderPanel()
    expect(await screen.findByRole('link', { name: 'DEM-2026-0002' })).toHaveAttribute('href', '/demandes/d2/accueil')
    expect(mocks.fetch).toHaveBeenCalledWith('c1')
    expect(screen.getByText(t(`${C}.role.participant`))).toBeInTheDocument()
    expect(screen.getByText('Pro Un')).toBeInTheDocument()
    expect(screen.getByText(t(`${C}.closedBecause`, { reason: t('modules.demandes.options.closedReason.withdrew') }))).toBeInTheDocument()
  })

  it('none: said plainly', async () => {
    mocks.fetch.mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText(t(`${C}.empty`))).toBeInTheDocument()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { ApproachesPage } from './ApproachesPage'

const mocks = vi.hoisted(() => ({ counts: vi.fn() }))
vi.mock('../api/approach-counts', () => ({ fetchApproachCounts: mocks.counts }))

const A = 'modules.professionals.approaches'

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{renderWithContexts(<ApproachesPage />, { path: '/professionnels/approches' })}</QueryClientProvider>)
}

afterEach(() => vi.clearAllMocks())

describe('« Approches » (P4-561): counted, never on a fiche', () => {
  it('lists each approach with its count of active professionals, the most held first', async () => {
    mocks.counts.mockResolvedValue([
      { id: 'a1', key: 'cbt', name: 'Approche cognitive et comportementale (TCC)', isActive: true, professionals: 2 },
      { id: 'a2', key: 'narrative', name: 'Approche narrative', isActive: true, professionals: 5 },
      { id: 'a3', key: 'schema', name: 'Thérapie des schémas', isActive: false, professionals: 1 },
    ])
    renderPage()
    const table = await screen.findByRole('table', { name: t(`${A}.table`) })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual([
      'Approche narrative5',
      'Approche cognitive et comportementale (TCC)2',
      `Thérapie des schémas${t(`${A}.archived`)}1`,
    ])
  })

  it('says so while no active professional has checked any', async () => {
    mocks.counts.mockResolvedValue([{ id: 'a1', key: 'cbt', name: 'TCC', isActive: true, professionals: 0 }])
    renderPage()
    expect(await screen.findByText(t(`${A}.empty.title`))).toBeInTheDocument()
  })
})

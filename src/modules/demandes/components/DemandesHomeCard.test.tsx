import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { DemandesHomeCard } from './DemandesHomeCard'

const mocks = vi.hoisted(() => ({ fetchCounts: vi.fn() }))
vi.mock('../api/demandes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/demandes')>()), fetchCounts: mocks.fetchCounts }))

const H = 'modules.demandes.home'

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { container } = render(<QueryClientProvider client={queryClient}>{renderWithContexts(<DemandesHomeCard />, { path: '/accueil' })}</QueryClientProvider>)
  return container
}

afterEach(() => vi.clearAllMocks())

describe('Accueil « Demandes à traiter » (L29)', () => {
  it('each figure that is not zero links to the inbox filtered on it; mine last', async () => {
    mocks.fetchCounts.mockResolvedValue({ open: 9, late: 2, no_answer: 0, due: 1, mine: 3, unassigned: 4, waitlist: 5 })
    renderCard()
    expect(await screen.findByRole('heading', { name: t(`${H}.title`) })).toBeInTheDocument()
    expect(screen.getByText(t(`${H}.body`, { count: '9' }))).toBeInTheDocument()
    const links = screen.getAllByRole('link')
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      [`2${t(`${H}.items.late`)}`, '/demandes?filtres=en-retard'],
      [`1${t(`${H}.items.due`)}`, '/demandes?filtres=a-rappeler'],
      [`4${t(`${H}.items.unassigned`)}`, '/demandes?pour=personne'],
      [`3${t(`${H}.items.mine`)}`, '/demandes?pour=moi'],
    ])
  })

  it('a clear queue shows nothing (Accueil stays calm)', async () => {
    mocks.fetchCounts.mockResolvedValue({ open: 3, late: 0, no_answer: 0, due: 0, mine: 3, unassigned: 0, waitlist: 0 })
    const container = renderCard()
    await waitFor(() => expect(mocks.fetchCounts).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

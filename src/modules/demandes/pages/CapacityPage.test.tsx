import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { CapacityBoard, CapacityRow } from '../api/capacity'
import { CapacityPage } from './CapacityPage'

const mocks = vi.hoisted(() => ({
  api: { fetchCapacityBoard: vi.fn(), setNewClientPlaces: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/capacity', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/capacity')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.demandes.capacity'

const row = (over: Partial<CapacityRow>): CapacityRow => ({
  professional_id: 'p1',
  display_name: 'Pro Un',
  primary_title_label: 'Psychologue',
  accepting_new_clients: true,
  availability_periods: ['evening'],
  matching_note: null,
  matching_priority_reason: null,
  places_declared: 3,
  places_used: 1,
  places_left: 2,
  places_set_at: '2026-10-03T14:00:00Z',
  languages: ['Français'],
  matched_30_days: 1,
  ...over,
})

const BOARD: CapacityBoard = {
  total_left: 2,
  tracked: 2,
  with_places: 1,
  last_snapshot_on: '2026-10-13',
  professionals: [
    row({ professional_id: 'p1', display_name: 'Anne Places', matching_note: 'Écrire avant de réserver.' }),
    row({ professional_id: 'p2', display_name: 'Bruno Complet', places_declared: 2, places_used: 2, places_left: 0, matching_priority_reason: 'Nouvelle' }),
    row({ professional_id: 'p3', display_name: 'Chloé Libre', places_declared: null, places_used: null, places_left: null, places_set_at: null, accepting_new_clients: false }),
  ],
}

beforeEach(() => {
  mocks.api.fetchCapacityBoard.mockResolvedValue(BOARD)
  mocks.api.setNewClientPlaces.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

function renderPage(role: 'counselor' | 'admin' = 'counselor', path = '/demandes/places') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(<CapacityPage />, { access: { access: accessForRole(role, { modules: ['demandes', 'clients', 'professionals'] }) }, path })}
    </QueryClientProvider>,
  )
}

describe('CapacityPage', () => {
  it('the board: by name, places left of declared and since when, the total; « Complets » is a warning', async () => {
    renderPage()
    expect(await screen.findByText(`${t(`${C}.totalPlacesOther`, { count: '2' })} ${t(`${C}.totalTrackedOther`, { count: '2' })}`)).toBeInTheDocument()
    const table = screen.getByRole('table', { name: t(`${C}.title`) })
    const names = within(table).getAllByRole('link').map((a) => a.textContent)
    expect(names).toEqual(['Anne Places', 'Bruno Complet', 'Chloé Libre'])
    expect(within(table).getByText(t(`${C}.placesOfOther`, { left: '2', declared: '3' }))).toBeInTheDocument()
    expect(within(table).getByText(t(`${C}.placesOfOne`, { left: '0', declared: '2' }))).toBeInTheDocument()
    expect(within(table).getByText('0 place restante sur 2')).toBeInTheDocument()
    expect(within(table).getByText(t(`${C}.untracked`))).toBeInTheDocument()
    expect(within(table).getByText(t(`${C}.notAccepting`))).toBeInTheDocument()
    expect(within(table).getByText('Écrire avant de réserver.')).toBeInTheDocument()
    expect(within(table).getByText('Nouvelle')).toBeInTheDocument()
  })

  it('a load error is said, with « Réessayer »', async () => {
    mocks.api.fetchCapacityBoard.mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText(t(`${C}.loadError`))).toBeInTheDocument()
  })

  it('views are real tabs with their counts', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('table', { name: t(`${C}.title`) })
    const full = screen.getByRole('tab', { name: new RegExp(`^${t(`${C}.view.full`)}`) })
    expect(full).toHaveTextContent('1')
    await user.click(full)
    const table = screen.getByRole('table', { name: t(`${C}.title`) })
    expect(within(table).getAllByRole('link').map((a) => a.textContent)).toEqual(['Bruno Complet'])
  })

  it('« Modifier »: the places, « Recommencer le décompte »; a wrong number is refused before the database', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${C}.editFor`, { name: 'Anne Places' }) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${C}.form.title`, { name: 'Anne Places' }) })
    const input = within(dialog).getByRole('textbox', { name: t(`${C}.form.places`) })
    await user.clear(input)
    await user.type(input, '120')
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(t(`${C}.form.invalid`))
    await user.clear(input)
    await user.type(input, '4')
    await user.click(within(dialog).getByRole('checkbox', { name: t(`${C}.form.restart`) }))
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.setNewClientPlaces).toHaveBeenCalledWith('p1', 4, true))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.form.saved`, { name: 'Anne Places' }))
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { AgendaReference } from '../api/agenda'
import { MyAgendaPage } from './AgendaPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchMyAgendaReference: vi.fn(),
    fetchAgenda: vi.fn(),
    fetchAvailability: vi.fn(),
    fetchAppointmentDetail: vi.fn(),
    bookPersonalAppointment: vi.fn(),
    bookAppointment: vi.fn(),
  },
  changes: { fetchBookingConsents: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/agenda', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/agenda')>()), ...mocks.api }))
vi.mock('../api/changes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/changes')>()), ...mocks.changes }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@/modules/clients', () => ({
  ClientPicker: ({ onSelect }: { onSelect: (id: string, client: { id: string; name: string; clientNumber: number }) => void }) => (
    <button type="button" onClick={() => onSelect('c1', { id: 'c1', name: 'Alice Essai', clientNumber: 1 })}>
      Choisir Alice
    </button>
  ),
}))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const A = 'modules.appointments.agenda'
const P = 'modules.appointments.personal'
const E = 'modules.appointments.editor'

const REFERENCE: AgendaReference = {
  professionals: [{ id: 'p1', name: 'Félix Gauthier', active: true, titleIds: ['t1'] }],
  services: [{ id: 's50', code: 10150, name: 'Consultation individuelle 50 min', durationMinutes: 50, bufferAfterMinutes: 10, forTwo: false, colour: null, titleIds: ['t1'] }],
  reasons: [{ id: 'r1', key: 'not_specified', name: 'Non spécifiée', active: true }],
}

beforeEach(() => {
  mocks.api.fetchMyAgendaReference.mockResolvedValue(REFERENCE)
  mocks.api.fetchAgenda.mockResolvedValue([])
  mocks.api.fetchAvailability.mockResolvedValue({ rules: [], exceptions: [] })
  mocks.api.fetchAppointmentDetail.mockResolvedValue(null)
  mocks.api.bookPersonalAppointment.mockResolvedValue('new')
  mocks.api.bookAppointment.mockResolvedValue('a-new')
  mocks.changes.fetchBookingConsents.mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <UnsavedChangesProvider>
          <MyAgendaPage />
        </UnsavedChangesProvider>,
        { path: '/mon-agenda?date=2027-03-15', access: { access: accessForRole('provider') } },
      )}
    </QueryClientProvider>,
  )
}

describe('MyAgendaPage', () => {
  it('her own agenda: no professional or service filter, no « Clients sans rappel »', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: t('modules.appointments.mine.title') })).toBeInTheDocument()
    expect(screen.queryByLabelText(t(`${A}.professional`))).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('modules.appointments.withoutReminder.title') })).not.toBeInTheDocument()
    await waitFor(() => expect(mocks.api.fetchAgenda).toHaveBeenCalledWith('2027-03-15T04:00:00.000Z', '2027-03-22T04:00:00.000Z', ['p1']))
  })

  it('a click on a free quarter hour adds a personal appointment there', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { level: 1, name: t('modules.appointments.mine.title') })
    // Tuesday, 12:00 (6:00 + 6 h at 48 px per hour).
    fireEvent.click(await screen.findByTestId('agenda-column-2027-03-16'), { clientY: 6 * 48 + 1 })
    const dialog = await screen.findByRole('dialog', { name: t(`${P}.title`) })
    await user.type(within(dialog).getByLabelText(/^Libellé/), 'Dentiste')
    await user.click(within(dialog).getByRole('button', { name: t(`${P}.save`) }))
    await waitFor(() =>
      expect(mocks.api.bookPersonalAppointment).toHaveBeenCalledWith({
        startsAt: '2027-03-16T16:00:00.000Z',
        endsAt: '2027-03-16T17:00:00.000Z',
        label: 'Dentiste',
        isWork: false,
      }),
    )
  })

  it('R-82: « Rendez-vous avec un client » books her own client on her agenda, at any hour, with no reason asked', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: t('modules.appointments.mine.newClient') }))
    const sheet = await screen.findByRole('dialog', { name: t(`${E}.newTitle`) })
    expect(within(sheet).getByLabelText(/^Professionnel/)).toHaveValue('p1')
    await user.selectOptions(within(sheet).getByLabelText(/^Service/), 's50')
    const hour = within(sheet).getByLabelText(/^Heure/)
    await user.clear(hour)
    await user.type(hour, '19:00')
    await user.click(within(sheet).getByRole('button', { name: 'Choisir Alice' }))
    await user.click(within(sheet).getByRole('button', { name: t(`${E}.book`) }))
    await waitFor(() => expect(mocks.api.bookAppointment).toHaveBeenCalled())
    expect(mocks.api.bookAppointment.mock.calls[0]?.[0]).toMatchObject({
      professionalId: 'p1',
      serviceId: 's50',
      startsAt: '2027-03-15T23:00:00.000Z',
      clientIds: ['c1'],
      outsideAvailabilityReason: null,
    })
    expect(within(sheet).queryByText(t(`${E}.outsideTitle`))).not.toBeInTheDocument()
  })

  it('… and the personal appointment dialog offers it at the same moment', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { level: 1, name: t('modules.appointments.mine.title') })
    fireEvent.click(await screen.findByTestId('agenda-column-2027-03-16'), { clientY: 6 * 48 + 1 })
    const dialog = await screen.findByRole('dialog', { name: t(`${P}.title`) })
    await user.click(within(dialog).getByRole('button', { name: t(`${P}.withClient`) }))
    const sheet = await screen.findByRole('dialog', { name: t(`${E}.newTitle`) })
    expect(within(sheet).getByLabelText(/^Heure/)).toHaveValue('12:00')
  })
})

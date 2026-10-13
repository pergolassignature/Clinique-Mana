import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import type { AgendaReference } from '../api/agenda'
import type { AgendaAppointment } from '../api/parse'
import { AgendaPage } from './AgendaPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchAgendaReference: vi.fn(),
    fetchAgenda: vi.fn(),
    fetchAvailability: vi.fn(),
    fetchAppointmentDetail: vi.fn(),
    bookAppointment: vi.fn(),
    moveAppointment: vi.fn(),
    previewSeries: vi.fn(),
    createSeries: vi.fn(),
    cancelSeriesFrom: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/agenda', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/agenda')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
vi.mock('@/modules/clients', () => ({
  ClientPicker: ({ onSelect }: { onSelect: (id: string, client: { id: string; name: string; clientNumber: number }) => void }) => (
    <button type="button" onClick={() => onSelect('c1', { id: 'c1', name: 'Alice Essai', clientNumber: 1 })}>
      Choisir Alice
    </button>
  ),
}))

const A = 'modules.appointments.agenda'
const E = 'modules.appointments.editor'

const REFERENCE: AgendaReference = {
  professionals: [{ id: 'p1', name: 'Félix Gauthier', active: true, titleIds: ['t1'] }],
  services: [{ id: 's50', code: 10150, name: 'Consultation individuelle 50 min', durationMinutes: 50, bufferAfterMinutes: 10, forTwo: false, colour: null, titleIds: ['t1'] }],
  reasons: [{ id: 'r1', key: 'not_specified', name: 'Non spécifiée', active: true }],
}

const appointment = (overrides: Partial<AgendaAppointment> = {}): AgendaAppointment => ({
  id: 'a1',
  professionalId: 'p1',
  serviceId: 's50',
  // Monday 2027-03-15 10:00 in Montréal (EDT).
  startsAt: '2027-03-15T14:00:00Z',
  endsAt: '2027-03-15T14:50:00Z',
  blocksUntil: '2027-03-15T15:00:00Z',
  mode: 'video',
  state: 'booked',
  isPersonal: false,
  personalLabel: null,
  keptOnSchedule: false,
  cancelLate: null,
  cancelReasonId: null,
  confirmedAt: null,
  outsideAvailability: false,
  balanceOverride: false,
  videoUrl: null,
  videoStatus: null,
  participants: [{ clientId: 'c1', name: 'Alice Essai', clientNumber: 1, role: 'client', presence: 'expected', confirmedAt: null }],
  seriesId: null,
  ...overrides,
})

beforeEach(() => {
  mocks.api.fetchAgendaReference.mockResolvedValue(REFERENCE)
  mocks.api.fetchAgenda.mockResolvedValue([appointment()])
  mocks.api.fetchAvailability.mockResolvedValue({
    rules: [{ id: 'w1', professionalId: 'p1', weekday: 1, startTime: '09:00', endTime: '17:00', serviceIds: [], visibleToClients: true, overflowAllowed: false, validFrom: '2026-01-01', validUntil: null }],
    exceptions: [],
  })
  mocks.api.fetchAppointmentDetail.mockResolvedValue(null)
  mocks.api.bookAppointment.mockResolvedValue('new')
  mocks.api.moveAppointment.mockResolvedValue(undefined)
  mocks.api.previewSeries.mockResolvedValue([
    { occurrence: 1, startsAt: '2027-03-15T14:00:00Z', endsAt: '2027-03-15T14:50:00Z', conflict: null },
    { occurrence: 2, startsAt: '2027-03-29T14:00:00Z', endsAt: '2027-03-29T14:50:00Z', conflict: 'overlap' },
    { occurrence: 3, startsAt: '2027-04-12T14:00:00Z', endsAt: '2027-04-12T14:50:00Z', conflict: null },
  ])
  mocks.api.createSeries.mockResolvedValue('series')
  mocks.api.cancelSeriesFrom.mockResolvedValue(2)
})
afterEach(() => vi.clearAllMocks())

function renderPage({ role = 'counselor' as FixtureRole, path = '/agenda?date=2027-03-15&professionnel=p1' } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <UnsavedChangesProvider>
          <AgendaPage />
        </UnsavedChangesProvider>,
        { path, access: { access: accessForRole(role) } },
      )}
    </QueryClientProvider>,
  )
}

describe('AgendaPage', () => {
  it('shows the week of one professional: four views as real tabs, the appointment at its clinic time', async () => {
    renderPage()
    const tabs = await screen.findByRole('tablist', { name: t(`${A}.views`) })
    expect(within(tabs).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Jour', 'Semaine', 'Prochains jours', 'Mois'])
    expect(await screen.findByRole('button', { name: '10:00, Alice Essai' })).toBeInTheDocument()
    expect(mocks.api.fetchAgenda).toHaveBeenCalledWith('2027-03-15T04:00:00.000Z', '2027-03-22T04:00:00.000Z', ['p1'])
  })

  it('a click on a free quarter hour opens « Nouveau rendez-vous » there; the booking goes to the database', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: '10:00, Alice Essai' })
    // Tuesday's column, 11:30 (7:00 + 4.5 h at 48 px per hour).
    const column = screen.getByTestId('agenda-column-2027-03-16')
    fireEvent.click(column, { clientY: 4.5 * 48 + 1 })
    const sheet = await screen.findByRole('dialog', { name: t(`${E}.newTitle`) })
    expect(within(sheet).getByLabelText(/^Heure/)).toHaveValue('11:30')
    await user.selectOptions(within(sheet).getByLabelText(/^Service/), 's50')
    await user.click(within(sheet).getByRole('button', { name: 'Choisir Alice' }))
    await user.click(within(sheet).getByRole('button', { name: t(`${E}.book`) }))
    await waitFor(() => expect(mocks.api.bookAppointment).toHaveBeenCalled())
    expect(mocks.api.bookAppointment.mock.calls[0]?.[0]).toMatchObject({ professionalId: 'p1', serviceId: 's50', startsAt: '2027-03-16T15:30:00.000Z', clientIds: ['c1'], outsideAvailabilityReason: null })
  })

  it('outside the availability: the staff book with a « Hors disponibilités » reason (AP-12)', async () => {
    const user = userEvent.setup()
    mocks.api.bookAppointment.mockRejectedValueOnce({ code: 'P0001', hint: 'outside_availability', message: 'Ce créneau est en dehors des disponibilités du professionnel pour ce service.' })
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${A}.new`) }))
    const sheet = await screen.findByRole('dialog', { name: t(`${E}.newTitle`) })
    await user.selectOptions(within(sheet).getByLabelText(/^Service/), 's50')
    await user.click(within(sheet).getByRole('button', { name: 'Choisir Alice' }))
    await user.click(within(sheet).getByRole('button', { name: t(`${E}.book`) }))
    expect(await within(sheet).findByText(t(`${E}.outsideTitle`))).toBeInTheDocument()
    await user.type(within(sheet).getByRole('textbox', { name: /^Raison « Hors disponibilités »/ }), 'Soirée exceptionnelle')
    await user.click(within(sheet).getByRole('button', { name: t(`${E}.book`) }))
    await waitFor(() => expect(mocks.api.bookAppointment).toHaveBeenCalledTimes(2))
    expect(mocks.api.bookAppointment.mock.calls[1]?.[0]).toMatchObject({ outsideAvailabilityReason: 'Soirée exceptionnelle' })
  })

  it('drags an appointment by 30 minutes (15-minute snapping): the move goes to the database', async () => {
    renderPage()
    const block = await screen.findByRole('button', { name: '10:00, Alice Essai' })
    fireEvent.pointerDown(block, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(block, { clientY: 124, pointerId: 1 })
    fireEvent.pointerUp(block, { clientY: 124, pointerId: 1 })
    await waitFor(() => expect(mocks.api.moveAppointment).toHaveBeenCalledWith({ id: 'a1', startsAt: '2027-03-15T14:30:00.000Z', professionalId: null, outsideAvailabilityReason: null }))
  })

  it('a held slot (R1b): hatched « En attente d’acceptation », never dragged, managed from the demande', async () => {
    const user = userEvent.setup()
    mocks.api.fetchAgenda.mockResolvedValue([appointment({ state: 'held' })])
    renderPage()
    const block = await screen.findByRole('button', { name: '10:00, Alice Essai' })
    expect(within(block).getByText("En attente d'acceptation")).toBeInTheDocument()
    expect(block.className).toContain('border-dashed')
    fireEvent.pointerDown(block, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(block, { clientY: 124, pointerId: 1 })
    fireEvent.pointerUp(block, { clientY: 124, pointerId: 1 })
    await user.click(block)
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText(t(`${E}.heldNotice`))).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: t(`${E}.move`) })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('combobox', { name: "Présence d'Alice Essai" })).toBeDisabled()
    expect(mocks.api.moveAppointment).not.toHaveBeenCalled()
  })

  it('a series every 2 weeks (R3): the dates and their conflict from the database, booked once the conflict is skipped', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: t(`${A}.new`) }))
    const sheet = await screen.findByRole('dialog', { name: t(`${E}.newTitle`) })
    await user.selectOptions(within(sheet).getByLabelText(/^Service/), 's50')
    await user.click(within(sheet).getByRole('button', { name: 'Choisir Alice' }))
    await user.click(within(sheet).getByRole('checkbox', { name: t(`${E}.series.repeat`) }))
    await user.selectOptions(within(sheet).getByLabelText(/^Fréquence/), '2')
    expect(await within(sheet).findByText('3 dates, dont 1 en conflit.')).toBeInTheDocument()
    expect(within(sheet).getByText(t(`${E}.series.conflict.overlap`))).toBeInTheDocument()
    expect(mocks.api.previewSeries).toHaveBeenLastCalledWith(
      expect.objectContaining({ professionalId: 'p1', serviceId: 's50', intervalWeeks: 2, weekdays: [1], count: 10, until: null }),
    )
    const submit = within(sheet).getByRole('button', { name: 'Réserver 3 rendez-vous' })
    expect(submit).toHaveAttribute('aria-disabled', 'true')
    await user.click(within(sheet).getByRole('checkbox', { name: 'Ignorer les dates en conflit (1)' }))
    await user.click(within(sheet).getByRole('button', { name: 'Réserver 2 rendez-vous' }))
    await waitFor(() => expect(mocks.api.createSeries).toHaveBeenCalled())
    expect(mocks.api.createSeries.mock.calls[0]?.[0]).toMatchObject({ intervalWeeks: 2, weekdays: [1], count: 10, clientIds: ['c1'], skipConflicts: true })
    expect(mocks.api.bookAppointment).not.toHaveBeenCalled()
  })

  it('cancels the rest of a series from one of its appointments', async () => {
    const user = userEvent.setup()
    mocks.api.fetchAgenda.mockResolvedValue([appointment({ seriesId: 'series' })])
    renderPage()
    await user.click(await screen.findByRole('button', { name: '10:00, Alice Essai' }))
    const sheet = await screen.findByRole('dialog')
    await user.click(within(sheet).getByRole('tab', { name: t(`${E}.tabs.cancel`) }))
    await user.selectOptions(within(sheet).getByLabelText(/^Raison/), 'not_specified')
    await user.click(within(sheet).getByRole('checkbox', { name: t(`${E}.series.cancelRest`) }))
    await user.click(within(sheet).getByRole('button', { name: t(`${E}.cancelSubmit`) }))
    await waitFor(() => expect(mocks.api.cancelSeriesFrom).toHaveBeenCalledWith('a1', 'not_specified', null, false))
  })

  it('availability mode: one professional at a time', async () => {
    renderPage({ path: '/agenda?date=2027-03-15&mode=disponibilites' })
    expect(await screen.findByText(t(`${A}.choosePro`))).toBeInTheDocument()
  })

  it('… with the professional chosen, a window opens « Modifier la plage »', async () => {
    const user = userEvent.setup()
    renderPage({ path: '/agenda?date=2027-03-15&mode=disponibilites&professionnel=p1' })
    await user.click(await screen.findByRole('button', { name: t(`${A}.windowLabel`, { start: '09:00', end: '17:00' }) }))
    expect(await screen.findByRole('dialog', { name: t('modules.appointments.availability.editTitle') })).toBeInTheDocument()
  })

  it('the adjointe books too', async () => {
    renderPage({ role: 'admin_assistant' })
    expect(await screen.findByRole('button', { name: t(`${A}.new`) })).toBeInTheDocument()
  })
})

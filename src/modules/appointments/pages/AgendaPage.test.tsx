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
    setAvailabilityWindow: vi.fn(),
    undoAvailabilityWindow: vi.fn(),
    deleteAvailabilityRule: vi.fn(),
    restoreAvailabilityRule: vi.fn(),
    addAvailabilityException: vi.fn(),
  },
  changes: {
    changeAppointmentService: vi.fn(),
    restoreAppointment: vi.fn(),
    confirmAppointment: vi.fn(),
    fetchAppointmentConsents: vi.fn(),
    fetchBookingConsents: vi.fn(),
  },
  messages: { fetchWithoutReminder: vi.fn() },
  history: { fetchAppointmentHistory: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../api/agenda', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/agenda')>()), ...mocks.api }))
vi.mock('../api/changes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/changes')>()), ...mocks.changes }))
vi.mock('../api/messages', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/messages')>()), ...mocks.messages }))
vi.mock('../api/history', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/history')>()), ...mocks.history }))
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
const D = 'modules.appointments.availability'
const E = 'modules.appointments.editor'
const AVAILABILITY = '/agenda?date=2027-03-15&mode=disponibilites&professionnel=p1'

const REFERENCE: AgendaReference = {
  professionals: [{ id: 'p1', name: 'Félix Gauthier', active: true, titleIds: ['t1'] }],
  services: [
    { id: 's50', code: 10150, name: 'Consultation individuelle 50 min', durationMinutes: 50, bufferAfterMinutes: 10, forTwo: false, colour: null, titleIds: ['t1'] },
    { id: 's30', code: 10130, name: 'Consultation individuelle 30 min', durationMinutes: 30, bufferAfterMinutes: 0, forTwo: false, colour: null, titleIds: ['t1'] },
  ],
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
  mocks.api.setAvailabilityWindow.mockImplementation(async (input: { id: string | null; weekday: number; start: number; end: number; validUntil: string | null }) => ({
    id: input.id ?? 'w2',
    weekday: input.weekday,
    start: input.start,
    end: input.end,
    validFrom: '2027-03-15',
    validUntil: input.validUntil,
    previous: null,
    absorbed: [],
    outsideCount: 0,
  }))
  mocks.api.undoAvailabilityWindow.mockResolvedValue(undefined)
  mocks.api.deleteAvailabilityRule.mockResolvedValue(undefined)
  mocks.api.restoreAvailabilityRule.mockResolvedValue('w1b')
  mocks.api.addAvailabilityException.mockResolvedValue('x1')
  mocks.changes.changeAppointmentService.mockResolvedValue(undefined)
  mocks.changes.restoreAppointment.mockResolvedValue(undefined)
  mocks.changes.confirmAppointment.mockResolvedValue(undefined)
  mocks.changes.fetchAppointmentConsents.mockResolvedValue([])
  mocks.changes.fetchBookingConsents.mockResolvedValue([])
  mocks.messages.fetchWithoutReminder.mockResolvedValue([])
  mocks.history.fetchAppointmentHistory.mockResolvedValue([])
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

  it('on a phone the day is the default view (a week of seven columns does not fit)', async () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) =>
      ({ matches: query === '(max-width: 639px)', media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList) as typeof window.matchMedia
    try {
      renderPage()
      const tabs = await screen.findByRole('tablist', { name: t(`${A}.views`) })
      expect(within(tabs).getByRole('tab', { name: 'Jour' })).toHaveAttribute('aria-selected', 'true')
      await waitFor(() => expect(mocks.api.fetchAgenda).toHaveBeenCalledWith('2027-03-15T04:00:00.000Z', '2027-03-16T04:00:00.000Z', ['p1']))
    } finally {
      window.matchMedia = original
    }
  })

  it('a click on a free quarter hour opens « Nouveau rendez-vous » there; the booking goes to the database', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: '10:00, Alice Essai' })
    // Tuesday's column, 11:30 (6:00 + 5.5 h at 48 px per hour).
    const column = screen.getByTestId('agenda-column-2027-03-16')
    fireEvent.click(column, { clientY: 5.5 * 48 + 1 })
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

  it('… with the professional chosen, a click on a window offers its choices; « Plus d’options… » opens « Modifier la plage »', async () => {
    const user = userEvent.setup()
    renderPage({ path: AVAILABILITY })
    await user.click(await screen.findByRole('button', { name: t(`${A}.windowLabel`, { start: '09:00', end: '17:00' }) }))
    expect(await screen.findByRole('button', { name: t(`${D}.remove`) })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${D}.more`) }))
    expect(await screen.findByRole('dialog', { name: t(`${D}.editTitle`) })).toBeInTheDocument()
  })

  it('a drag on an empty part of a day draws a window, saved at once with the defaults, then told with « Annuler »', async () => {
    renderPage({ path: AVAILABILITY })
    await screen.findByRole('button', { name: t(`${A}.windowLabel`, { start: '09:00', end: '17:00' }) })
    // Tuesday from 9:00 (3 h below 6:00 at 48 px an hour) to 12:00 (6 h).
    const column = screen.getByTestId('agenda-column-2027-03-16')
    fireEvent.pointerDown(column, { clientY: 3 * 48 + 1, button: 0, pointerId: 1 })
    fireEvent.pointerMove(column, { clientY: 6 * 48, pointerId: 1 })
    expect(screen.getByTestId('availability-ghost')).toHaveTextContent('9 h – 12 h')
    fireEvent.pointerUp(column, { clientY: 6 * 48, pointerId: 1 })
    await waitFor(() =>
      expect(mocks.api.setAvailabilityWindow).toHaveBeenCalledWith({
        id: null,
        professionalId: 'p1',
        weekday: 2,
        start: 9 * 60,
        end: 12 * 60,
        validFrom: '2027-03-15',
        validUntil: null,
        week: '2027-03-15',
      }),
    )
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled())
    const [message, options] = mocks.toast.success.mock.calls[0]!
    expect(message).toBe('Disponible le mardi 9 h – 12 h, chaque semaine')
    expect(options.action.label).toBe(t(`${D}.onlyThisWeek`))
    expect(options.cancel.label).toBe(t(`${D}.undo`))
    // « Seulement cette semaine »: the same window, Monday to Sunday.
    options.action.onClick()
    await waitFor(() =>
      expect(mocks.api.setAvailabilityWindow).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'w2', validFrom: '2027-03-15', validUntil: '2027-03-21' })),
    )
    // « Annuler »: the drop undone.
    options.cancel.onClick()
    await waitFor(() => expect(mocks.api.undoAvailabilityWindow).toHaveBeenCalledWith(expect.objectContaining({ id: 'w2' })))
  })

  it('a window dragged down moves it; its bottom edge resizes it; appointments left outside are warned of', async () => {
    mocks.api.setAvailabilityWindow.mockResolvedValueOnce({
      id: 'w1', weekday: 1, start: 9 * 60, end: 16 * 60, validFrom: '2026-01-01', validUntil: null, previous: null, absorbed: [], outsideCount: 2,
    })
    renderPage({ path: AVAILABILITY })
    const block = await screen.findByRole('button', { name: t(`${A}.windowLabel`, { start: '09:00', end: '17:00' }) })
    const bottom = block.querySelector('[data-edge="end"]')!
    fireEvent.pointerDown(bottom, { clientY: 500, button: 0, pointerId: 2 })
    fireEvent.pointerMove(bottom, { clientY: 500 - 48, pointerId: 2 })
    fireEvent.pointerUp(bottom, { clientY: 500 - 48, pointerId: 2 })
    await waitFor(() =>
      expect(mocks.api.setAvailabilityWindow).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1', weekday: 1, start: 9 * 60, end: 16 * 60, validFrom: '2026-01-01', validUntil: null })),
    )
    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalled())
    expect(mocks.toast.warning.mock.calls[0]![1].description).toBe(t(`${D}.outsideOther`, { count: '2' }))

    fireEvent.pointerDown(block, { clientY: 300, button: 0, pointerId: 3 })
    fireEvent.pointerMove(block, { clientY: 300 + 24, pointerId: 3 })
    fireEvent.pointerUp(block, { clientY: 300 + 24, pointerId: 3 })
    await waitFor(() => expect(mocks.api.setAvailabilityWindow).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'w1', start: 9 * 60 + 30, end: 17 * 60 + 30 })))
  })

  it('« Supprimer » deletes the window, with « Annuler »; « Seulement cette semaine » limits it to the week', async () => {
    const user = userEvent.setup()
    renderPage({ path: AVAILABILITY })
    const block = await screen.findByRole('button', { name: t(`${A}.windowLabel`, { start: '09:00', end: '17:00' }) })
    await user.click(block)
    await user.click(await screen.findByRole('button', { name: t(`${D}.onlyThisWeek`) }))
    await waitFor(() =>
      expect(mocks.api.setAvailabilityWindow).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1', validFrom: '2027-03-15', validUntil: '2027-03-21' })),
    )
    await user.click(block)
    await user.click(await screen.findByRole('button', { name: t(`${D}.remove`) }))
    await waitFor(() => expect(mocks.api.deleteAvailabilityRule).toHaveBeenCalledWith('w1'))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Plage supprimée : lundi 9 h – 17 h', expect.anything()))
    const options = mocks.toast.success.mock.calls.find(([m]) => m === 'Plage supprimée : lundi 9 h – 17 h')![1]
    options.action.onClick()
    await waitFor(() => expect(mocks.api.restoreAvailabilityRule).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1' })))
  })

  it('« Bloquer »: a drag takes the time off (an exception); « En vacances toute la semaine »', async () => {
    const user = userEvent.setup()
    renderPage({ path: AVAILABILITY })
    await screen.findByRole('button', { name: t(`${A}.windowLabel`, { start: '09:00', end: '17:00' }) })
    await user.click(screen.getByRole('button', { name: t(`${D}.toolBlock`) }))
    const column = screen.getByTestId('agenda-column-2027-03-17')
    fireEvent.pointerDown(column, { clientY: 4 * 48, button: 0, pointerId: 4 })
    fireEvent.pointerMove(column, { clientY: 5 * 48, pointerId: 4 })
    fireEvent.pointerUp(column, { clientY: 5 * 48, pointerId: 4 })
    // Wednesday 10:00–11:00 in Montréal (EDT).
    await waitFor(() =>
      expect(mocks.api.addAvailabilityException).toHaveBeenCalledWith({
        professionalId: 'p1', kind: 'other', startsAt: '2027-03-17T14:00:00.000Z', endsAt: '2027-03-17T15:00:00.000Z', label: null,
      }),
    )
    await user.click(screen.getByRole('button', { name: t(`${D}.vacationWeek`) }))
    await waitFor(() => expect(mocks.api.addAvailabilityException).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'vacation', startsAt: '2027-03-15T04:00:00.000Z' })))
  })

  it('« Ajouter une plage »: the keyboard way, the full editor', async () => {
    const user = userEvent.setup()
    renderPage({ path: AVAILABILITY })
    await user.click(await screen.findByRole('button', { name: t(`${D}.addWindow`) }))
    expect(await screen.findByRole('dialog', { name: t(`${D}.newTitle`) })).toBeInTheDocument()
  })

  describe('the parity audit (AP-28 … AP-32)', () => {
    it('« Changer le service »: the same moment, the new service; an overlap is shown as written', async () => {
      const user = userEvent.setup()
      mocks.changes.changeAppointmentService.mockRejectedValueOnce({ code: 'P0001', hint: 'overlap', message: 'Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).' })
      renderPage()
      await user.click(await screen.findByRole('button', { name: '10:00, Alice Essai' }))
      const sheet = await screen.findByRole('dialog')
      const service = within(sheet).getByRole('combobox', { name: /^Service/ })
      expect(service).toHaveValue('s50')
      const submit = within(sheet).getByRole('button', { name: t(`${E}.changeService`) })
      expect(submit).toHaveAttribute('aria-disabled', 'true')
      await user.selectOptions(service, 's30')
      expect(within(sheet).getByText(t(`${E}.serviceHelp`, { duration: '30', buffer: '0' }))).toBeInTheDocument()
      await user.click(submit)
      expect(await within(sheet).findByText('Ce professionnel a déjà un rendez-vous sur ce créneau (pause après comprise).')).toBeInTheDocument()
      await user.click(submit)
      await waitFor(() => expect(mocks.changes.changeAppointmentService).toHaveBeenLastCalledWith('a1', 's30', null))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.appointments.saved.serviceChanged')))
    })

    it('« Marquer confirmé » on a booked appointment (the staff)', async () => {
      const user = userEvent.setup()
      renderPage()
      await user.click(await screen.findByRole('button', { name: '10:00, Alice Essai' }))
      const sheet = await screen.findByRole('dialog')
      await user.click(within(sheet).getByRole('button', { name: t(`${E}.markConfirmed`) }))
      await waitFor(() => expect(mocks.changes.confirmAppointment).toHaveBeenCalledWith('a1'))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.appointments.saved.confirmed')))
    })

    it('a confirmed appointment offers no « Marquer confirmé »', async () => {
      const user = userEvent.setup()
      mocks.api.fetchAgenda.mockResolvedValue([appointment({ state: 'confirmed' })])
      renderPage()
      await user.click(await screen.findByRole('button', { name: '10:00, Alice Essai' }))
      const sheet = await screen.findByRole('dialog')
      expect(within(sheet).queryByRole('button', { name: t(`${E}.markConfirmed`) })).not.toBeInTheDocument()
    })

    it('« Rétablir » a cancelled appointment still to come; a taken slot is shown as written', async () => {
      const user = userEvent.setup()
      mocks.api.fetchAgenda.mockResolvedValue([appointment({ state: 'cancelled', cancelReasonId: 'r1', startsAt: '2099-03-16T14:00:00Z', endsAt: '2099-03-16T14:50:00Z' })])
      mocks.changes.restoreAppointment.mockRejectedValueOnce({ code: 'P0001', hint: 'overlap', message: 'Le créneau est maintenant pris : ce rendez-vous ne peut pas être rétabli.' })
      renderPage({ path: '/agenda?date=2099-03-16&professionnel=p1' })
      await user.click(await screen.findByRole('button', { name: /Alice Essai/ }))
      const sheet = await screen.findByRole('dialog')
      await user.click(within(sheet).getByRole('tab', { name: t(`${E}.tabs.cancel`) }))
      const restore = within(sheet).getByRole('button', { name: t(`${E}.restore`) })
      await user.click(restore)
      expect(await within(sheet).findByText('Le créneau est maintenant pris : ce rendez-vous ne peut pas être rétabli.')).toBeInTheDocument()
      await user.click(restore)
      await waitFor(() => expect(mocks.changes.restoreAppointment).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.appointments.saved.restored')))
    })

    it('a past cancelled appointment: no « Rétablir », the reason said', async () => {
      const user = userEvent.setup()
      mocks.api.fetchAgenda.mockResolvedValue([appointment({ state: 'cancelled', cancelReasonId: 'r1', startsAt: '2026-01-05T15:00:00Z', endsAt: '2026-01-05T15:50:00Z' })])
      renderPage({ path: '/agenda?date=2026-01-05&professionnel=p1' })
      await user.click(await screen.findByRole('button', { name: /Alice Essai/ }))
      const sheet = await screen.findByRole('dialog')
      await user.click(within(sheet).getByRole('tab', { name: t(`${E}.tabs.cancel`) }))
      expect(within(sheet).getByText(t(`${E}.restorePast`))).toBeInTheDocument()
      expect(within(sheet).queryByRole('button', { name: t(`${E}.restore`) })).not.toBeInTheDocument()
    })

    it('the consents still to sign: on the appointment and at booking, by name; never blocking', async () => {
      const user = userEvent.setup()
      mocks.changes.fetchAppointmentConsents.mockResolvedValue([
        { clientId: 'c1', consentKey: 'general', consentName: 'Consentement général', state: 'missing' },
        { clientId: 'c1', consentKey: 'waitlist', consentName: 'Liste d’attente', state: 'signed' },
      ])
      mocks.changes.fetchBookingConsents.mockResolvedValue([{ clientId: 'c1', consentKey: 'general', consentName: 'Consentement général', state: 'pending' }])
      renderPage()
      await user.click(await screen.findByRole('button', { name: '10:00, Alice Essai' }))
      let sheet = await screen.findByRole('dialog')
      const C = `${E}.consents`
      expect(await within(sheet).findByText(t(`${C}.line`, { name: 'Consentement général', state: t(`${C}.state.missing`) }))).toBeInTheDocument()
      expect(within(sheet).queryByText(/Liste d’attente/)).not.toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: t(`${A}.new`) }))
      sheet = await screen.findByRole('dialog', { name: t(`${E}.newTitle`) })
      await user.selectOptions(within(sheet).getByLabelText(/^Service/), 's50')
      await user.click(within(sheet).getByRole('button', { name: 'Choisir Alice' }))
      expect(await within(sheet).findByText(t(`${C}.line`, { name: 'Consentement général', state: t(`${C}.state.pending`) }))).toBeInTheDocument()
      expect(mocks.changes.fetchBookingConsents).toHaveBeenLastCalledWith('s50', ['c1'])
      await user.click(within(sheet).getByRole('button', { name: t(`${E}.book`) }))
      await waitFor(() => expect(mocks.api.bookAppointment).toHaveBeenCalled())
    })

    it('« Clients sans rappel »: « Marquer confirmé » after the call; a confirmed one says so', async () => {
      const user = userEvent.setup()
      mocks.messages.fetchWithoutReminder.mockResolvedValue([
        { id: 'a1', professionalId: 'p1', startsAt: '2027-03-15T14:00:00Z', participants: [{ clientId: 'c1', name: 'Alice Essai', clientNumber: 1 }], confirmed: false },
        { id: 'a2', professionalId: 'p1', startsAt: '2027-03-16T14:00:00Z', participants: [{ clientId: 'c2', name: 'Marc Essai', clientNumber: 2 }], confirmed: true },
      ])
      renderPage()
      await user.click(await screen.findByRole('button', { name: t('modules.appointments.withoutReminder.title') }))
      const sheet = await screen.findByRole('dialog', { name: t('modules.appointments.withoutReminder.title') })
      expect(within(sheet).getByText(t('modules.appointments.withoutReminder.confirmedBadge'))).toBeInTheDocument()
      await user.click(within(sheet).getByRole('button', { name: t('modules.appointments.withoutReminder.markConfirmedLabel', { name: 'Alice Essai' }) }))
      await waitFor(() => expect(mocks.changes.confirmAppointment).toHaveBeenCalledWith('a1'))
    })
  })

  describe('the grid, part 2 (AP-33)', () => {
    it('an appointment outside 6:00–22:00 widens the grid: never hidden, drawn with its height', async () => {
      // Monday 2027-03-15 at 5:00 and 22:30 in Montréal (EDT).
      mocks.api.fetchAgenda.mockResolvedValue([
        appointment({ id: 'early', startsAt: '2027-03-15T09:00:00Z', endsAt: '2027-03-15T09:50:00Z' }),
        appointment({ id: 'late', startsAt: '2027-03-16T02:30:00Z', endsAt: '2027-03-16T03:20:00Z' }),
      ])
      renderPage()
      const early = await screen.findByRole('button', { name: '05:00, Alice Essai' })
      const late = screen.getByRole('button', { name: '22:30, Alice Essai' })
      expect(early.style.top).toBe('0px')
      expect(early.style.height).toBe('40px')
      // 5:00 to 24:00 at 48 px an hour: 22:30 is 17.5 h below 5:00.
      expect(late.style.top).toBe(`${17.5 * 48}px`)
      expect(screen.getByTestId('agenda-column-2027-03-15').style.height).toBe(`${19 * 48}px`)
    })

    it("a service with a colour marks the block's left edge", async () => {
      mocks.api.fetchAgendaReference.mockResolvedValue({ ...REFERENCE, services: [{ ...REFERENCE.services[0]!, colour: '#2f855a' }] })
      renderPage()
      const block = await screen.findByRole('button', { name: '10:00, Alice Essai' })
      expect(block.style.borderLeftColor).toBe('#2f855a')
      expect(block.style.borderLeftWidth).toBe('4px')
    })

    it('`rendez-vous=<id>` opens the appointment (a link from the client file); closing it drops the parameter', async () => {
      const user = userEvent.setup()
      mocks.api.fetchAgenda.mockResolvedValue([appointment({ id: '00000000-0000-4000-8000-0000000000a1' })])
      renderPage({ path: '/agenda?date=2027-03-15&professionnel=p1&rendez-vous=00000000-0000-4000-8000-0000000000a1' })
      expect(await screen.findByRole('dialog', { name: 'Alice Essai' })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('« Historique »: who did what, by day, in plain words', async () => {
      const user = userEvent.setup()
      mocks.history.fetchAppointmentHistory.mockResolvedValue([
        { id: 2, created_at: '2027-03-10T15:00:00Z', table_name: 'appointments', record_id: 'a1', action: 'update',
          changed_fields: { state: { before: 'booked', after: 'confirmed' }, updated_at: { before: 'x', after: 'y' } }, actor_id: 'u1', actor_name: 'Rachel Essai', actor_role: 'counselor', source: 'rpc:confirm_appointment' },
        { id: 1, created_at: '2027-03-09T15:00:00Z', table_name: 'appointments', record_id: 'a1', action: 'insert',
          changed_fields: { service_id: 's50', professional_id: 'p1', internal_note: '(masqué)' }, actor_id: 'u1', actor_name: 'Rachel Essai', actor_role: 'counselor', source: 'app' },
      ])
      renderPage()
      await user.click(await screen.findByRole('button', { name: '10:00, Alice Essai' }))
      const sheet = await screen.findByRole('dialog')
      await user.click(within(sheet).getByRole('tab', { name: t(`${E}.tabs.history`) }))
      expect(await within(sheet).findAllByText('Rachel Essai')).toHaveLength(2)
      expect(within(sheet).getByText('Félix Gauthier', { selector: 'li span' })).toBeInTheDocument()
      expect(within(sheet).getByText(/10150 · Consultation individuelle 50 min/)).toBeInTheDocument()
      expect(mocks.history.fetchAppointmentHistory).toHaveBeenCalledWith('a1', null)
    })
  })

  it('the adjointe books too', async () => {
    renderPage({ role: 'admin_assistant' })
    expect(await screen.findByRole('button', { name: t(`${A}.new`) })).toBeInTheDocument()
  })
})

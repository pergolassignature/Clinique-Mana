import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { AgendaReference } from '../api/agenda'
import type { AgendaAppointment } from '../api/parse'
import { AgendaPrintPage } from './AgendaPrintPage'

const mocks = vi.hoisted(() => ({ api: { fetchAgendaReference: vi.fn(), fetchAgenda: vi.fn() } }))
vi.mock('../api/agenda', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/agenda')>()), ...mocks.api }))

const P = 'modules.appointments.print'
const REFERENCE: AgendaReference = {
  professionals: [
    { id: 'p1', name: 'Félix Gauthier', active: true, titleIds: ['t1'] },
    { id: 'p2', name: 'Julie Morin', active: true, titleIds: ['t1'] },
  ],
  services: [{ id: 's50', code: 10150, name: 'Consultation individuelle 50 min', durationMinutes: 50, bufferAfterMinutes: 10, forTwo: false, colour: null, titleIds: ['t1'], excludedProfessionalIds: [] }],
  reasons: [],
}

const appointment = (overrides: Partial<AgendaAppointment>): AgendaAppointment => ({
  id: 'a1',
  professionalId: 'p1',
  serviceId: 's50',
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
  reminderStatus: null,
  unreachable: false,
  ...overrides,
})

function open(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{renderWithContexts(<AgendaPrintPage />, { path, access: { access: accessForRole('counselor') } })}</QueryClientProvider>)
}

afterEach(() => vi.clearAllMocks())

describe('AgendaPrintPage', () => {
  it('a day: per professional, the time, the client, the service and mode, the state; a cancellation only when kept on the schedule', async () => {
    mocks.api.fetchAgendaReference.mockResolvedValue(REFERENCE)
    mocks.api.fetchAgenda.mockResolvedValue([
      appointment({}),
      appointment({ id: 'a2', professionalId: 'p2', startsAt: '2027-03-15T15:00:00Z', endsAt: '2027-03-15T15:50:00Z', state: 'confirmed', participants: [{ clientId: 'c2', name: 'Bruno Essai', clientNumber: 2, role: 'client', presence: 'expected', confirmedAt: null }] }),
      appointment({ id: 'a3', startsAt: '2027-03-15T16:00:00Z', endsAt: '2027-03-15T16:50:00Z', state: 'cancelled', participants: [{ clientId: 'c3', name: 'Chloé Annulée', clientNumber: 3, role: 'client', presence: 'expected', confirmedAt: null }] }),
    ])
    open('/agenda/imprimer?vue=jour&date=2027-03-15')
    const sheet = await screen.findByRole('article', { name: t(`${P}.title`) })
    expect(within(sheet).getByRole('heading', { level: 1 })).toHaveTextContent('lundi 15 mars 2027')
    expect(await within(sheet).findByRole('heading', { level: 3, name: 'Félix Gauthier' })).toBeInTheDocument()
    expect(within(sheet).getByRole('heading', { level: 3, name: 'Julie Morin' })).toBeInTheDocument()
    const alice = (await within(sheet).findByText('Alice Essai')).closest('tr') as HTMLElement
    expect(alice).toHaveTextContent('10:00 – 10:50')
    expect(alice).toHaveTextContent('Consultation individuelle 50 min · ')
    expect(within(sheet).queryByText('Chloé Annulée')).not.toBeInTheDocument()
    expect(mocks.api.fetchAgenda).toHaveBeenCalledWith(expect.any(String), expect.any(String), null)
  })

  it('a week of one professional: each day, « Aucun rendez-vous. » where there is none; the print button', async () => {
    mocks.api.fetchAgendaReference.mockResolvedValue(REFERENCE)
    mocks.api.fetchAgenda.mockResolvedValue([appointment({})])
    open('/agenda/imprimer?date=2027-03-17&professionnel=p1')
    const sheet = await screen.findByRole('article', { name: t(`${P}.title`) })
    expect(within(sheet).getByRole('heading', { level: 1 })).toHaveTextContent(t(`${P}.week`, { date: '15 mars 2027' }))
    expect(await within(sheet).findAllByRole('heading', { level: 2 })).toHaveLength(7)
    expect(await within(sheet).findAllByText(t(`${P}.none`))).toHaveLength(6)
    expect(within(sheet).getByRole('button', { name: t(`${P}.print`) })).toBeInTheDocument()
    expect(mocks.api.fetchAgenda).toHaveBeenCalledWith(expect.any(String), expect.any(String), ['p1'])
  })
})

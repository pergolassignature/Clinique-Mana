import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { DemandeBundle, DemandesReference } from '../api/demandes'
import { DemandeRecordPage } from './DemandeRecordPage'

const mocks = vi.hoisted(() => ({
  api: {
    getDemande: vi.fn(),
    fetchReference: vi.fn(),
    updateDemande: vi.fn(),
    setDemandeState: vi.fn(),
    assignDemande: vi.fn(),
    setHandler: vi.fn(),
    completeTask: vi.fn(),
    cancelTask: vi.fn(),
    addTask: vi.fn(),
    saveNote: vi.fn(),
    saveParticipants: vi.fn(),
    logContact: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/demandes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/demandes')>()), ...mocks.api }))
vi.mock('@/core/realtime/use-org-realtime', () => ({ useOrgRealtime: () => undefined }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
// Clients' picker (its own tests in Clients): a stand-in that shows what it was given and picks « c9 ».
vi.mock('@/modules/clients', () => ({
  ClientPicker: (props: { onSelect: (id: string, client: null) => void; excludeIds?: readonly string[]; initialValues?: Record<string, string> }) => (
    <button type="button" onClick={() => props.onSelect('c9', null)}>
      {`picker ${props.initialValues?.firstName}|${props.initialValues?.lastName}|${props.initialValues?.mobile}|${props.excludeIds?.join(',')}`}
    </button>
  ),
}))

const R = 'modules.demandes.record'
const ID = 'e0000000-0000-0000-0000-000000000001'

function bundle(over: Partial<DemandeBundle> = {}, demande: Partial<DemandeBundle['demande']> = {}): DemandeBundle {
  return {
    demande: {
      id: ID,
      reference: 'DEM-2026-0007',
      received_at: '2026-10-12T14:00:00Z',
      received_by_name: 'Conseillère A',
      channel: 'phone',
      referral_source_id: null,
      source_campaign: null,
      source_referrer: null,
      client_id: 'c1',
      contact_name: 'Alice Tremblay',
      contact_email: null,
      contact_phone_e164: '+15145550101',
      beneficiary: 'self',
      previous_therapy: null,
      language: 'fr',
      modality: 'any',
      availability_periods: ['evening'],
      availability_days: [2],
      preferred_pro_gender: 'any',
      profession_title_id: null,
      clientele_id: null,
      concerns: 'Anxiété',
      payer_kind: 'unknown',
      insurer: null,
      state: 'new',
      closed_reason: null,
      closed_at: null,
      is_urgent: false,
      assigned_to: null,
      assigned_name: null,
      matched_professional_id: null,
      contact_attempts: 1,
      last_contact_at: '2026-10-12T15:00:00Z',
      next_contact_at: null,
      handled_by: null,
      handled_by_name: null,
      handled_at: null,
      waiting_hours: 1,
      promise: 'met',
      no_answer: true,
      first_contact_at: '2026-10-12T15:00:00Z',
      last_outcome: 'no_answer',
      person_name: 'Alice Tremblay',
      ...demande,
    },
    client: { id: 'c1', client_number: 42, display_name: 'Alice Tremblay', email: 'alice@exemple.test', mobile_e164: null, birthday: null, is_archived: false },
    matched_professional: null,
    motif_ids: [],
    participants: [],
    tasks: [
      {
        id: 'k1',
        kind: 'callback',
        due_at: '2026-10-14T14:00:00Z',
        state: 'open',
        outcome: null,
        assigned_to: null,
        assigned_name: null,
        done_at: null,
        done_by_name: null,
      },
    ],
    events: [
      { id: 'v2', kind: 'contact', from_state: null, to_state: null, closed_reason: null, contact_channel: 'phone', contact_outcome: 'no_answer', professional_name: null, assignee_name: null, at: '2026-10-12T15:00:00Z', by_name: 'Conseillère A' },
      { id: 'v1', kind: 'created', from_state: null, to_state: 'new', closed_reason: null, contact_channel: null, contact_outcome: null, professional_name: null, assignee_name: null, at: '2026-10-12T14:00:00Z', by_name: 'Conseillère A' },
    ],
    note: { internal_note: 'Préfère le soir.', updated_at: '2026-10-12T15:00:00Z', updated_by_name: 'Conseillère A' },
    can: { manage: true, notes: true },
    ...over,
  }
}

const reference: DemandesReference = {
  workers: [{ user_id: 'a1', display_name: 'Conseillère A' }],
  referral_sources: [],
  motifs: [{ id: 'm1', name: 'Anxiété', category_id: 'cat1', category_name: 'Émotions' }],
  profession_titles: [{ id: 't1', name: 'Psychologue' }],
  clienteles: [{ id: 'cl1', name: 'Adultes' }],
}

beforeEach(() => {
  mocks.api.getDemande.mockResolvedValue(bundle())
  mocks.api.fetchReference.mockResolvedValue(reference)
  for (const fn of ['updateDemande', 'setDemandeState', 'assignDemande', 'setHandler', 'completeTask', 'cancelTask', 'addTask', 'saveNote', 'saveParticipants', 'logContact'] as const) {
    mocks.api[fn].mockResolvedValue(undefined)
  }
})
afterEach(() => vi.clearAllMocks())

function renderPage(tab = 'accueil'): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="demandes/:id/:onglet?" element={<DemandeRecordPage />} />
        </Routes>,
        { access: { access: accessForRole('counselor', { modules: ['demandes', 'clients', 'professionals'] }) }, path: `/demandes/${ID}/${tab}` },
      )}
    </QueryClientProvider>,
  )
  return queryClient
}

describe('DemandeRecordPage', () => {
  it('heads the record: the person, the number, the state, the promise, the file; four real tabs', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Alice Tremblay' })).toBeInTheDocument()
    expect(screen.getByText('DEM-2026-0007')).toBeInTheDocument()
    expect(screen.getByText(t('modules.demandes.promise.met'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${R}.openFile`, { number: '42' }) })).toHaveAttribute('href', '/clients/c1')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Accueil', 'Participants', 'Suivi1', 'Historique'])
  })

  it('Accueil: only what changed is saved', async () => {
    const user = userEvent.setup()
    renderPage()
    const concerns = await screen.findByRole('textbox', { name: t('modules.demandes.intake.need.concerns') })
    await user.clear(concerns)
    await user.type(concerns, 'Anxiété, sommeil')
    await user.click(screen.getByRole('checkbox', { name: 'Anxiété' }))
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.updateDemande).toHaveBeenCalledTimes(1))
    expect(mocks.api.updateDemande).toHaveBeenCalledWith(ID, { concerns: 'Anxiété, sommeil', motif_ids: ['m1'] })
  })

  it('another counselor\'s save while editing: the edits stay, « Recharger » offered', async () => {
    const user = userEvent.setup()
    const queryClient = renderPage()
    const concerns = await screen.findByRole('textbox', { name: t('modules.demandes.intake.need.concerns') })
    await user.type(concerns, ' et sommeil')
    mocks.api.getDemande.mockResolvedValue(bundle({}, { concerns: 'Changé ailleurs' }))
    await queryClient.invalidateQueries()
    expect(await screen.findByText(t(`${R}.stale`))).toBeInTheDocument()
    expect(concerns).toHaveValue('Anxiété et sommeil')
    await user.click(screen.getByRole('button', { name: t(`${R}.reload`) }))
    expect(screen.getByRole('textbox', { name: t('modules.demandes.intake.need.concerns') })).toHaveValue('Changé ailleurs')
  })

  it('« Changer de dossier »: Clients\' picker, prefilled with the contact; the file chosen becomes the request\'s', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: t('modules.demandes.intake.file.change') }))
    const picker = await screen.findByRole('button', { name: 'picker Alice|Tremblay|514 555-0101|c1' })
    await user.click(picker)
    await waitFor(() => expect(mocks.api.updateDemande).toHaveBeenCalledWith(ID, { client_id: 'c9' }))
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.demandes.clientLink.linked'))
  })

  it('closing asks for the reason', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.selectOptions(await screen.findByRole('combobox', { name: t(`${R}.changeState`) }), 'closed')
    const dialog = await screen.findByRole('alertdialog')
    await user.selectOptions(within(dialog).getByRole('combobox', { name: t(`${R}.close.reason`) }), 'withdrew')
    await user.click(within(dialog).getByRole('button', { name: t(`${R}.close.action`) }))
    await waitFor(() => expect(mocks.api.setDemandeState).toHaveBeenCalledWith(ID, 'closed', 'withdrew'))
  })

  it('« Je m\'en occupe » taken by someone else asks before taking over', async () => {
    const user = userEvent.setup()
    mocks.api.getDemande.mockResolvedValue(bundle({}, { handled_by: 'someone-else', handled_by_name: 'Conseillère B', handled_at: '2026-10-12T15:30:00Z' }))
    renderPage()
    expect(await screen.findByText(/Conseillère B s’en occupe depuis/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${R}.take`) }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: t(`${R}.takeOver.action`) }))
    await waitFor(() => expect(mocks.api.setHandler).toHaveBeenCalledWith(ID, true, 'someone-else'))
  })

  it('Suivi: a task done with its outcome; the internal note saved', async () => {
    const user = userEvent.setup()
    renderPage('suivi')
    await user.click(await screen.findByRole('button', { name: /Rappel : fait/ }))
    await waitFor(() => expect(mocks.api.completeTask).toHaveBeenCalledWith(ID, 'k1', 'reached'))
    const note = screen.getByRole('textbox', { name: t('modules.demandes.followUp.note.label') })
    await user.type(note, ' Disponible mardi.')
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.saveNote).toHaveBeenCalledWith(ID, 'Préfère le soir. Disponible mardi.'))
  })

  it('Suivi without demandes.notes: no note', async () => {
    mocks.api.getDemande.mockResolvedValue(bundle({ note: null, can: { manage: true, notes: false } }))
    renderPage('suivi')
    expect(await screen.findByText(t('modules.demandes.followUp.tasks.title'))).toBeInTheDocument()
    expect(screen.queryByText(t('modules.demandes.followUp.note.title'))).not.toBeInTheDocument()
  })

  it('Participants: the file of the request added as the main person', async () => {
    const user = userEvent.setup()
    renderPage('participants')
    await user.click(await screen.findByRole('button', { name: t('modules.demandes.participants.addFile', { file: 'N° 42 · Alice Tremblay' }) }))
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.saveParticipants).toHaveBeenCalledTimes(1))
    expect(mocks.api.saveParticipants.mock.calls[0]![1]).toEqual([
      { client_id: 'c1', display_name: null, relationship: 'self', birthday: null, is_primary: true },
    ])
  })

  it('Historique: the events in plain words, by whom', async () => {
    renderPage('historique')
    expect(await screen.findByText(t('modules.demandes.history.created'))).toBeInTheDocument()
    expect(screen.getByText(t('modules.demandes.history.contact', { channel: 'Téléphone', outcome: 'Pas de réponse' }))).toBeInTheDocument()
  })

  it('a request that is not the clinic\'s: « Demande introuvable »', async () => {
    mocks.api.getDemande.mockResolvedValue(null)
    renderPage()
    expect(await screen.findByText(t(`${R}.notFound.title`))).toBeInTheDocument()
  })
})

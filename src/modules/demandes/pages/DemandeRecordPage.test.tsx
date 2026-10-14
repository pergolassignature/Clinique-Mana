import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { formatClinicDateTime } from '@/shared/lib/timezone'
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
    fetchDemandeConsents: vi.fn(),
  },
  waitlist: { listWaitlist: vi.fn(), fetchWaitlistLists: vi.fn(), registerWaitlist: vi.fn() },
  propositions: { listPropositions: vi.fn(), fetchPropositionServices: vi.fn(), fetchOpenSlots: vi.fn(), propose: vi.fn(), withdrawProposition: vi.fn() },
  matching: { fetchDemandeMatch: vi.fn(), fetchNextSlots: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/demandes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/demandes')>()), ...mocks.api }))
vi.mock('../api/waitlist', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/waitlist')>()), ...mocks.waitlist }))
vi.mock('../api/propositions', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/propositions')>()), ...mocks.propositions }))
vi.mock('../api/matching', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/matching')>()), ...mocks.matching }))
vi.mock('@/core/realtime/use-org-realtime', () => ({ useOrgRealtime: () => undefined }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
// Clients' picker (its own tests in Clients): a stand-in that shows what it was given and picks « c9 »
// (a file the picker does not name: « Nouveau dossier » until saved).
vi.mock('@/modules/clients', () => ({
  ClientPicker: (props: { onSelect: (id: string, client: null) => void; excludeIds?: readonly string[]; initialValues?: Record<string, string> }) => (
    <button type="button" onClick={() => props.onSelect('c9', null)}>
      {`picker ${props.initialValues?.firstName}|${props.initialValues?.lastName}|${props.initialValues?.mobile}|${props.excludeIds?.join(',')}`}
    </button>
  ),
}))

const R = 'modules.demandes.record'

const MATCH = {
  criteria: {
    demande_id: 'e0000000-0000-0000-0000-000000000001',
    client_id: 'c1',
    language: 'fr',
    beneficiary: 'self',
    profession_title_id: null,
    profession_title_name: null,
    clientele_id: null,
    clientele_name: null,
    preferred_pro_gender: 'any',
    availability_periods: ['evening'],
    motifs: [{ id: 'm1', name: 'Anxiété' }, { id: 'm2', name: 'Deuil' }],
    sex: 'female',
    age: 34,
    ignored: [],
  },
  professionals: [
    {
      professional_id: 'pro1', display_name: 'Pro Un', title_label: 'Psychologue', eligible: true, reasons: [], warnings: [],
      motif_hits: [{ id: 'm1', name: 'Anxiété' }, { id: 'm2', name: 'Deuil' }], refused_hits: [], specialized: true, period_hits: ['evening'], fit: 211,
      places_declared: 3, places_left: 3, insurance_status: 'valid', matching_note: 'Préfère les soirs.', priority_reason: null,
      availability_periods: ['evening'], updated_at: '2026-10-12T14:00:00Z', rank: 1,
    },
    {
      professional_id: 'pro2', display_name: 'Pro Deux', title_label: 'Travailleuse sociale', eligible: true,
      reasons: [], warnings: ['refused_motif', 'insurance_expired', 'no_places'],
      motif_hits: [{ id: 'm1', name: 'Anxiété' }], refused_hits: [{ id: 'm2', name: 'Deuil' }], specialized: false, period_hits: [], fit: 100,
      places_declared: 1, places_left: 0, insurance_status: 'expired', matching_note: null, priority_reason: 'Nouvelle : à remplir',
      availability_periods: [], updated_at: '2026-10-12T14:00:00Z', rank: 2,
    },
    {
      professional_id: 'pro3', display_name: 'Pro Trois', title_label: null, eligible: false, reasons: ['language', 'not_ready'], warnings: [],
      motif_hits: [], refused_hits: [], specialized: false, period_hits: [], fit: 0,
      places_declared: null, places_left: null, insurance_status: 'missing', matching_note: null, priority_reason: null,
      availability_periods: [], updated_at: null, rank: 3,
    },
  ],
}
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
      source_utm: null,
      source_landing_page: null,
      client_id: 'c1',
      contact_name: 'Alice Tremblay',
      contact_email: null,
      contact_phone_e164: '+15145550101',
      beneficiary: 'self',
      previous_therapy: null,
      has_issues: null,
      issues: [],
      issues_comment: null,
      previous_professionals: [],
      previous_comment: null,
      has_legal_context: null,
      legal_context: [],
      legal_detail: null,
      motif_other: null,
      availability_other: null,
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
  mocks.api.fetchDemandeConsents.mockResolvedValue([])
  mocks.waitlist.listWaitlist.mockResolvedValue([])
  mocks.waitlist.fetchWaitlistLists.mockResolvedValue([
    { target_kind: 'title', target_id: 't1', name: 'Psychologie', open_count: 4, incomplete_count: 0, to_call_count: 0, offered_count: 0, average_wait_days: 30 },
  ])
  mocks.waitlist.registerWaitlist.mockResolvedValue(['w1'])
  mocks.propositions.listPropositions.mockResolvedValue([])
  mocks.matching.fetchDemandeMatch.mockResolvedValue(MATCH)
  mocks.matching.fetchNextSlots.mockResolvedValue([])
  mocks.propositions.fetchPropositionServices.mockResolvedValue([{ id: 's50', code: 10150, name: 'Consultation 50 min', duration_minutes: 50, for_two: false }])
  mocks.propositions.fetchOpenSlots.mockResolvedValue([
    { starts_at: '2026-10-20T13:00:00Z', ends_at: '2026-10-20T13:50:00Z' },
    { starts_at: '2026-10-20T14:00:00Z', ends_at: '2026-10-20T14:50:00Z' },
    { starts_at: '2026-10-21T13:00:00Z', ends_at: '2026-10-21T13:50:00Z' },
  ])
  mocks.propositions.propose.mockResolvedValue({ proposition_id: 'pr1', emailed: true, expires_at: '2026-10-15T15:00:00Z' })
  mocks.propositions.withdrawProposition.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

function renderPage(tab = 'accueil', modules = ['demandes', 'clients', 'professionals'], without: readonly string[] = []): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="demandes/:id/:onglet?" element={<DemandeRecordPage />} />
        </Routes>,
        {
          access: { access: { ...accessForRole('counselor', { modules }), permissions: accessForRole('counselor').permissions.filter((p) => !without.includes(p)) } },
          path: `/demandes/${ID}/${tab}`,
        },
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
    expect(screen.getByRole('link', { name: t(`${R}.openFile`, { number: 'CLI-000042' }) })).toHaveAttribute('href', '/clients/c1')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Accueil', 'Participants', 'Suivi1', 'Jumelage', 'Historique'])
  })

  it('« Jumelage » only with professionals.view (the panel names « Bon à savoir »)', async () => {
    renderPage('accueil', ['demandes', 'clients'], ['professionals.view'])
    await screen.findByRole('heading', { level: 1, name: 'Alice Tremblay' })
    expect(screen.queryByRole('tab', { name: 'Jumelage' })).not.toBeInTheDocument()
  })

  it('Jumelage: the criteria, the suggestions in order with their badges, warnings and note; the others folded with why', async () => {
    const user = userEvent.setup()
    renderPage('jumelage')
    const M = 'modules.demandes.matching'
    expect(await screen.findByText('Français · 34 ans · Une femme')).toBeInTheDocument()
    expect(screen.getByText(t(`${M}.motifs`, { names: 'Anxiété et Deuil' }))).toBeInTheDocument()
    const list = screen.getByRole('list', { name: t(`${M}.title`) })
    const rows = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list)
    expect(rows.map((r) => within(r).getByText(/^Pro /).textContent)).toEqual(['Pro Un', 'Pro Deux'])
    expect(within(rows[0]!).getByText(t(`${M}.motifHits`, { names: 'Anxiété et Deuil', count: '2', total: '2' }))).toBeInTheDocument()
    expect(within(rows[0]!).getByText(t(`${M}.placesLeftOther`, { count: '3' }))).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Préfère les soirs.')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(t(`${M}.priority`))).toBeInTheDocument()
    expect(within(rows[1]!).getByText(t(`${M}.placesNone`))).toBeInTheDocument()
    expect(within(rows[1]!).getByText(t(`${M}.warnings.refused_motif`, { names: 'Deuil' }))).toBeInTheDocument()
    expect(within(rows[1]!).getByText(t(`${M}.warnings.insurance_expired`))).toBeInTheDocument()
    // Not a request one proposes to yet (« Nouvelle »): no « Proposer ».
    expect(screen.queryByRole('button', { name: t(`${M}.proposeTo`, { name: 'Pro Un' }) })).not.toBeInTheDocument()
    expect(screen.queryByText('Pro Trois')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${M}.others`, { count: '1' }) }))
    expect(screen.getByText('Pro Trois')).toBeInTheDocument()
    expect(screen.getByText(`${t(`${M}.reasons.language`)} · ${t(`${M}.reasons.not_ready`)}`)).toBeInTheDocument()
  })

  it('Jumelage: « Proposer » presets the professional; an expired insurance asks first', async () => {
    const user = userEvent.setup()
    mocks.api.getDemande.mockResolvedValue(bundle({}, { state: 'accepted' }))
    renderPage('jumelage', ['demandes', 'clients', 'professionals', 'appointments'])
    const M = 'modules.demandes.matching'
    await user.click(await screen.findByRole('button', { name: t(`${M}.proposeTo`, { name: 'Pro Deux' }) }))
    const confirm = await screen.findByRole('alertdialog', { name: t(`${M}.confirmInsurance.title`, { name: 'Pro Deux' }) })
    await user.click(within(confirm).getByRole('button', { name: t(`${M}.confirmInsurance.action`) }))
    const dialog = await screen.findByRole('dialog', { name: t('modules.demandes.propositions.form.title') })
    expect(within(dialog).getByRole('combobox', { name: t('modules.demandes.propositions.form.professional') })).toHaveValue('pro2')
    // Already confirmed in the panel: the form does not ask again.
    expect(within(dialog).queryByRole('checkbox', { name: t('modules.demandes.propositions.form.insuranceConfirm') })).not.toBeInTheDocument()
  })

  it('Jumelage: each eligible one shows her next free slot, with Rendez-vous on (A-7)', async () => {
    mocks.matching.fetchNextSlots.mockResolvedValue([
      { professional_id: 'pro1', service_id: 's50', service_name: 'Consultation 50 min', starts_at: '2026-10-20T22:00:00Z' },
      { professional_id: 'pro2', service_id: 's50', service_name: 'Consultation 50 min', starts_at: null },
    ])
    mocks.api.getDemande.mockResolvedValue(bundle({}, { state: 'accepted' }))
    renderPage('jumelage', ['demandes', 'clients', 'professionals', 'appointments'])
    const M = 'modules.demandes.matching'
    expect(
      await screen.findByText(t(`${M}.nextSlot.label`, { when: formatClinicDateTime('2026-10-20T22:00:00Z'), service: 'Consultation 50 min' })),
    ).toBeInTheDocument()
    expect(screen.getByText(t(`${M}.nextSlot.none`, { service: 'Consultation 50 min' }))).toBeInTheDocument()
    expect(mocks.matching.fetchNextSlots).toHaveBeenCalledWith(ID)
  })

  it('Jumelage: without Rendez-vous, no next slot is asked for', async () => {
    mocks.api.getDemande.mockResolvedValue(bundle({}, { state: 'accepted' }))
    renderPage('jumelage', ['demandes', 'clients', 'professionals'])
    await screen.findAllByText('Pro Deux')
    expect(mocks.matching.fetchNextSlots).not.toHaveBeenCalled()
  })

  it('Jumelage: « Offrir la plage » from the waiting list (?proposer=) opens the proposal to her', async () => {
    mocks.api.getDemande.mockResolvedValue(bundle({}, { state: 'waitlist' }))
    renderPage('jumelage?proposer=pro1', ['demandes', 'clients', 'professionals', 'appointments'])
    const dialog = await screen.findByRole('dialog', { name: t('modules.demandes.propositions.form.title') })
    expect(within(dialog).getByRole('combobox', { name: t('modules.demandes.propositions.form.professional') })).toHaveValue('pro1')
  })

  it('Jumelage: ?proposer= for someone no longer eligible says why, and opens nothing', async () => {
    mocks.api.getDemande.mockResolvedValue(bundle({}, { state: 'waitlist' }))
    renderPage('jumelage?proposer=pro3', ['demandes', 'clients', 'professionals', 'appointments'])
    const M = 'modules.demandes.matching'
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        t(`${M}.offer.notEligible`, { name: 'Pro Trois', reasons: `${t(`${M}.reasons.language`)}, ${t(`${M}.reasons.not_ready`)}` }),
      ),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Jumelage: ?proposer= with an expired insurance asks first', async () => {
    mocks.api.getDemande.mockResolvedValue(bundle({}, { state: 'waitlist' }))
    renderPage('jumelage?proposer=pro2', ['demandes', 'clients', 'professionals', 'appointments'])
    expect(await screen.findByRole('alertdialog', { name: t('modules.demandes.matching.confirmInsurance.title', { name: 'Pro Deux' }) })).toBeInTheDocument()
  })

  it('Suivi: proposing a professional whose insurance is expired asks for a confirmation (rule 8)', async () => {
    const user = userEvent.setup()
    mocks.waitlist.fetchWaitlistLists.mockResolvedValue([
      { target_kind: 'professional', target_id: 'pro2', name: 'Pro Deux', open_count: 0, incomplete_count: 0, to_call_count: 0, offered_count: 0, average_wait_days: null },
    ])
    mocks.api.getDemande.mockResolvedValue(bundle({}, { state: 'accepted' }))
    renderPage('suivi', ['demandes', 'clients', 'professionals', 'appointments'])
    await user.click(await screen.findByRole('button', { name: t('modules.demandes.propositions.open') }))
    const dialog = await screen.findByRole('dialog', { name: t('modules.demandes.propositions.form.title') })
    await user.selectOptions(await within(dialog).findByRole('combobox', { name: t('modules.demandes.propositions.form.professional') }), 'pro2')
    await user.selectOptions(await within(dialog).findByRole('combobox', { name: t('modules.demandes.propositions.form.service') }), 's50')
    // The request asks for evenings; her slots are mornings: the « seulement » filter (on) is lifted (A-8).
    await user.click(await within(dialog).findByRole('checkbox', { name: /Seulement aux moments/ }))
    await user.click((await within(dialog).findAllByRole('checkbox'))[1]!)
    const confirm = await within(dialog).findByRole('checkbox', { name: t('modules.demandes.propositions.form.insuranceConfirm') })
    await user.click(within(dialog).getByRole('button', { name: t('modules.demandes.propositions.form.sendOne') }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('modules.demandes.propositions.form.insuranceUnconfirmed'))
    expect(mocks.propositions.propose).not.toHaveBeenCalled()
    await user.click(confirm)
    await user.click(within(dialog).getByRole('button', { name: t('modules.demandes.propositions.form.sendOne') }))
    await waitFor(() => expect(mocks.propositions.propose).toHaveBeenCalledTimes(1))
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
    await waitFor(() => expect(mocks.api.setDemandeState).toHaveBeenCalledWith(ID, 'closed', 'withdrew', null))
  })

  it('« Jumelée » by hand asks for the professional (D-38)', async () => {
    const user = userEvent.setup()
    mocks.api.getDemande.mockResolvedValue(bundle({}, { state: 'accepted' }))
    mocks.waitlist.fetchWaitlistLists.mockResolvedValue([
      { target_kind: 'professional', target_id: 'pro1', name: 'Pro Un', open_count: 0, incomplete_count: 0, to_call_count: 0, offered_count: 0, average_wait_days: null },
    ])
    renderPage()
    await user.selectOptions(await screen.findByRole('combobox', { name: t(`${R}.changeState`) }), 'matched')
    const dialog = await screen.findByRole('dialog', { name: t(`${R}.match.title`) })
    await user.click(within(dialog).getByRole('button', { name: t(`${R}.match.action`) }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(t(`${R}.match.needed`))
    await user.selectOptions(await within(dialog).findByRole('combobox', { name: t(`${R}.match.professional`) }), 'pro1')
    await user.click(within(dialog).getByRole('button', { name: t(`${R}.match.action`) }))
    await waitFor(() => expect(mocks.api.setDemandeState).toHaveBeenCalledWith(ID, 'matched', null, 'pro1'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${R}.match.done`, { name: 'Pro Un' }))
  })

  it('Jumelage: « Jumeler » presets the professional in the match', async () => {
    const user = userEvent.setup()
    mocks.api.getDemande.mockResolvedValue(bundle({}, { state: 'waitlist' }))
    mocks.waitlist.fetchWaitlistLists.mockResolvedValue([
      { target_kind: 'professional', target_id: 'pro1', name: 'Pro Un', open_count: 0, incomplete_count: 0, to_call_count: 0, offered_count: 0, average_wait_days: null },
    ])
    renderPage('jumelage')
    await user.click(await screen.findByRole('button', { name: t('modules.demandes.matching.matchTo', { name: 'Pro Un' }) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${R}.match.title`) })
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: t(`${R}.match.professional`) })).toHaveValue('pro1'))
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
    await user.click(await screen.findByRole('button', { name: t('modules.demandes.participants.addFile', { file: 'CLI-000042 · Alice Tremblay' }) }))
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.saveParticipants).toHaveBeenCalledTimes(1))
    expect(mocks.api.saveParticipants.mock.calls[0]![1]).toEqual([
      { client_id: 'c1', display_name: null, relationship: 'self', birthday: null, is_primary: true },
    ])
  })

  it('Participants: another file of the clinic through Clients\' picker; a couple with one person is said, not blocked', async () => {
    const user = userEvent.setup()
    const P = 'modules.demandes.participants'
    mocks.api.getDemande.mockResolvedValue(
      bundle(
        { participants: [{ id: 'p1', client_id: 'c1', display_name: null, relationship: 'self', birthday: null, is_primary: true, client: { client_number: 42, display_name: 'Alice Tremblay' } }] },
        { beneficiary: 'couple' },
      ),
    )
    renderPage('participants')
    expect(await screen.findByText(t(`${P}.count.couple`, { count: '1' }))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${P}.addClient`) }))
    await user.click(await screen.findByRole('button', { name: 'picker undefined|undefined|undefined|c1' }))
    expect(screen.queryByText(t(`${P}.count.couple`, { count: '1' }))).not.toBeInTheDocument()
    expect(screen.getByText(t(`${P}.picker.newFile`))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.saveParticipants).toHaveBeenCalledTimes(1))
    expect(mocks.api.saveParticipants.mock.calls[0]![1]).toEqual([
      { id: 'p1', client_id: 'c1', display_name: null, relationship: 'self', birthday: null, is_primary: true },
      { client_id: 'c9', display_name: null, relationship: 'partner', birthday: null, is_primary: false },
    ])
  })

  it('Participants: each file\'s consents, live, and what to settle for the request (D-39)', async () => {
    const P = 'modules.demandes.participants'
    mocks.api.getDemande.mockResolvedValue(
      bundle({
        participants: [
          { id: 'p1', client_id: 'c1', display_name: null, relationship: 'self', birthday: null, is_primary: true, client: { client_number: 42, display_name: 'Alice Tremblay' } },
          { id: 'p2', client_id: 'c2', display_name: null, relationship: 'partner', birthday: null, is_primary: false, client: { client_number: 43, display_name: 'Bruno Tremblay' } },
        ],
      }),
    )
    mocks.api.fetchDemandeConsents.mockResolvedValue([
      { client_id: 'c1', consents: [{ key: 'general', name: 'Consentement général', state: 'signed' }] },
      { client_id: 'c2', consents: [{ key: 'general', name: 'Consentement général', state: 'missing' }] },
    ])
    renderPage('participants')
    expect(await screen.findByText(t(`${P}.consents.toSettle`))).toBeInTheDocument()
    const missing = t(`${P}.consents.state.missing`, { name: 'Consentement général' })
    expect(screen.getByText(t(`${P}.consents.fileLine`, { file: 'CLI-000043 · Bruno Tremblay', status: missing }))).toBeInTheDocument()
    expect(screen.getByText(t(`${P}.consents.valid`))).toBeInTheDocument()
    expect(screen.getAllByText(missing)).toHaveLength(1)
  })

  it('Participants: every consent valid says so', async () => {
    mocks.api.fetchDemandeConsents.mockResolvedValue([{ client_id: 'c1', consents: [{ key: 'general', name: 'Consentement général', state: 'signed' }] }])
    renderPage('participants')
    expect(await screen.findByText(t('modules.demandes.participants.consents.allValid'))).toBeInTheDocument()
  })

  it('Accueil: « Enjeux » Oui opens its follow-ups; « Non » clears them (D-40)', async () => {
    const user = userEvent.setup()
    const A = 'modules.demandes.intake.need'
    mocks.api.getDemande.mockResolvedValue(bundle({}, { has_issues: true, issues: ['coparenting'], issues_comment: 'Garde partagée' }))
    renderPage()
    expect(await screen.findByRole('checkbox', { name: 'Coparentalité' })).toBeChecked()
    expect(screen.getByRole('textbox', { name: t(`${A}.issuesComment`) })).toHaveValue('Garde partagée')
    await user.selectOptions(screen.getByRole('combobox', { name: t(`${A}.issues`) }), 'no')
    expect(screen.queryByRole('checkbox', { name: 'Coparentalité' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: t(`${A}.legal`) }), 'yes')
    await user.click(screen.getByRole('checkbox', { name: 'DPJ' }))
    await user.type(screen.getByRole('textbox', { name: t(`${A}.legalDetail`) }), 'Suivi en cours')
    await user.type(screen.getByRole('textbox', { name: t(`${A}.motifOther`) }), 'Deuil')
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.updateDemande).toHaveBeenCalledTimes(1))
    expect(mocks.api.updateDemande).toHaveBeenCalledWith(ID, {
      has_issues: false,
      issues: [],
      issues_comment: null,
      has_legal_context: true,
      legal_context: ['dpj'],
      legal_detail: 'Suivi en cours',
      motif_other: 'Deuil',
    })
  })

  it('Historique: the events in plain words, by whom', async () => {
    renderPage('historique')
    expect(await screen.findByText(t('modules.demandes.history.created'))).toBeInTheDocument()
    expect(screen.getByText(t('modules.demandes.history.contact', { channel: 'Téléphone', outcome: 'Pas de réponse' }))).toBeInTheDocument()
  })

  it('Accueil: where the request came from (D3c\'s card)', async () => {
    mocks.api.getDemande.mockResolvedValue(bundle({}, { channel: 'booking_page', source_campaign: 'automne', source_landing_page: 'https://cliniquemana.com/psy' }))
    renderPage()
    expect(await screen.findByRole('heading', { name: t('modules.demandes.sources.title') })).toBeInTheDocument()
    expect(screen.getByText('automne')).toBeInTheDocument()
    expect(screen.getByText('/psy')).toBeInTheDocument()
  })

  it('« Liste d\'attente » without an entry registers the request: a profession, a priority with its reason', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.selectOptions(await screen.findByRole('combobox', { name: t(`${R}.changeState`) }), 'waitlist')
    const dialog = await screen.findByRole('dialog', { name: t('modules.demandes.waitlist.register.title') })
    await user.selectOptions(await within(dialog).findByRole('combobox', { name: t('modules.demandes.waitlist.register.profession') }), 't1')
    await user.click(within(dialog).getByRole('button', { name: t('modules.demandes.waitlist.priority.priority') }))
    await user.click(within(dialog).getByRole('button', { name: t('modules.demandes.waitlist.register.save') }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(t('modules.demandes.waitlist.register.reasonNeeded'))
    await user.type(within(dialog).getByRole('textbox', { name: t('modules.demandes.waitlist.register.reason') }), 'Enfant en attente')
    await user.click(within(dialog).getByRole('button', { name: t('modules.demandes.waitlist.register.save') }))
    await waitFor(() =>
      expect(mocks.waitlist.registerWaitlist).toHaveBeenCalledWith(ID, { titleId: 't1', professionalId: null, priority: 'priority', priorityReason: 'Enfant en attente' }),
    )
    expect(mocks.api.setDemandeState).not.toHaveBeenCalled()
  })

  it('without a client file, registering says to link it first', async () => {
    const user = userEvent.setup()
    mocks.api.getDemande.mockResolvedValue(bundle({ client: null }, { client_id: null }))
    renderPage()
    await user.selectOptions(await screen.findByRole('combobox', { name: t(`${R}.changeState`) }), 'waitlist')
    const dialog = await screen.findByRole('dialog', { name: t('modules.demandes.waitlist.register.title') })
    expect(within(dialog).getByRole('alert')).toHaveTextContent(t('modules.demandes.waitlist.register.fileNeeded'))
  })

  it('Suivi: the request\'s entries with their rank and what is missing', async () => {
    mocks.waitlist.listWaitlist.mockResolvedValue([
      {
        id: 'w1', demande_id: ID, reference: 'DEM-2026-0007', client_id: 'c1', client_number: 42, person_name: 'Alice Tremblay',
        target_kind: 'title', target_id: 't1', target_name: 'Psychologie', priority: 'normal', priority_reason: null,
        registered_at: '2026-10-01T14:00:00Z', waited_days: 12, state: 'incomplete', fee_status: 'to_invoice', fee_waived_reason: null,
        consent_state: 'pending', last_contact_at: null, next_contact_at: null, bridge_professional_id: null, bridge_name: null,
        exit_reason: null, exited_at: null, rank: 3, list_size: 5, pending_offer: false, followup_unanswered: false,
      },
    ])
    renderPage('suivi')
    const card = await screen.findByRole('list', { name: t('modules.demandes.waitlist.card.title') })
    expect(within(card).getByRole('link', { name: 'Psychologie' })).toHaveAttribute('href', '/liste-attente?liste=t-t1')
    expect(within(card).getByText('3e sur 5')).toBeInTheDocument()
    expect(within(card).getByText(t('modules.demandes.waitlist.consent.pending'))).toBeInTheDocument()
    expect(within(card).getByText(t('modules.demandes.waitlist.fee.status.to_invoice'))).toBeInTheDocument()
  })

  it('Suivi: « Proposer un professionnel » holds 1 to 3 of her free slots and sends the proposal', async () => {
    const user = userEvent.setup()
    mocks.waitlist.fetchWaitlistLists.mockResolvedValue([
      { target_kind: 'professional', target_id: 'pro1', name: 'Pro Un', open_count: 0, incomplete_count: 0, to_call_count: 0, offered_count: 0, average_wait_days: null },
    ])
    mocks.api.getDemande.mockResolvedValue(bundle({}, { state: 'accepted' }))
    renderPage('suivi', ['demandes', 'clients', 'professionals', 'appointments'])
    await user.click(await screen.findByRole('button', { name: t('modules.demandes.propositions.open') }))
    const dialog = await screen.findByRole('dialog', { name: t('modules.demandes.propositions.form.title') })
    await user.selectOptions(await within(dialog).findByRole('combobox', { name: t('modules.demandes.propositions.form.professional') }), 'pro1')
    // Her default service is chosen once her services are read (A-8, D-48).
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: t('modules.demandes.propositions.form.service') })).toHaveValue('s50'))
    // The request asks for evenings; her slots are mornings: none at those moments until the filter is lifted.
    expect(await within(dialog).findByText(t('modules.demandes.propositions.form.noSlotInPeriods'))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('checkbox', { name: /Seulement aux moments/ }))
    expect(within(dialog).getAllByText(t('modules.demandes.propositions.form.periodOf.am')).length).toBeGreaterThan(0)
    const boxes = await within(dialog).findAllByRole('checkbox')
    await user.click(boxes[1]!)
    await user.click(boxes[3]!)
    await user.click(within(dialog).getByRole('button', { name: t('modules.demandes.propositions.form.send', { count: '2' }) }))
    await waitFor(() =>
      expect(mocks.propositions.propose).toHaveBeenCalledWith({
        demandeId: ID,
        professionalId: 'pro1',
        serviceId: 's50',
        startsAt: ['2026-10-20T13:00:00Z', '2026-10-21T13:00:00Z'],
        mode: 'video',
      }),
    )
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.demandes.propositions.sent'))
  })

  it('Suivi: a refusal of the function is shown in French (P3-40)', async () => {
    const user = userEvent.setup()
    const { FunctionCallError } = await import('@/core/supabase/functions')
    mocks.propositions.propose.mockRejectedValue(
      new FunctionCallError('invalid_request', 400, 'Demandes est réservé aux testeurs : aucune proposition ne part vers un client pour le moment.', { refusal: true }),
    )
    mocks.waitlist.fetchWaitlistLists.mockResolvedValue([
      { target_kind: 'professional', target_id: 'pro1', name: 'Pro Un', open_count: 0, incomplete_count: 0, to_call_count: 0, offered_count: 0, average_wait_days: null },
    ])
    mocks.api.getDemande.mockResolvedValue(bundle({}, { state: 'accepted' }))
    renderPage('suivi', ['demandes', 'clients', 'professionals', 'appointments'])
    await user.click(await screen.findByRole('button', { name: t('modules.demandes.propositions.open') }))
    const dialog = await screen.findByRole('dialog', { name: t('modules.demandes.propositions.form.title') })
    await user.selectOptions(await within(dialog).findByRole('combobox', { name: t('modules.demandes.propositions.form.professional') }), 'pro1')
    await user.selectOptions(await within(dialog).findByRole('combobox', { name: t('modules.demandes.propositions.form.service') }), 's50')
    // The request asks for evenings; her slots are mornings: the « seulement » filter (on) is lifted (A-8).
    await user.click(await within(dialog).findByRole('checkbox', { name: /Seulement aux moments/ }))
    await user.click((await within(dialog).findAllByRole('checkbox'))[1]!)
    await user.click(within(dialog).getByRole('button', { name: t('modules.demandes.propositions.form.sendOne') }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/réservé aux testeurs/)
  })

  it('Suivi: a pending proposal is withdrawn after asking', async () => {
    const user = userEvent.setup()
    mocks.propositions.listPropositions.mockResolvedValue([
      {
        id: 'pr1', professional_id: 'pro1', professional_name: 'Pro Un', service_name: 'Consultation 50 min', mode: 'video',
        slots: [{ appointment_id: 'a1', starts_at: '2026-10-20T13:00:00Z' }], proposed_at: '2026-10-13T14:00:00Z', proposed_by_name: 'Conseillère A',
        expires_at: '2026-10-15T14:00:00Z', response: 'pending', responded_at: null, decline_reason: null, accepted_starts_at: null,
      },
    ])
    renderPage('suivi', ['demandes', 'clients', 'professionals', 'appointments'])
    await user.click(await screen.findByRole('button', { name: t('modules.demandes.propositions.withdraw') }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: t('modules.demandes.propositions.withdraw') }))
    await waitFor(() => expect(mocks.propositions.withdrawProposition).toHaveBeenCalledWith('pr1'))
    expect(screen.queryByRole('button', { name: t('modules.demandes.propositions.open') })).not.toBeInTheDocument()
  })

  it('a request that is not the clinic\'s: « Demande introuvable »', async () => {
    mocks.api.getDemande.mockResolvedValue(null)
    renderPage()
    expect(await screen.findByText(t(`${R}.notFound.title`))).toBeInTheDocument()
  })
})

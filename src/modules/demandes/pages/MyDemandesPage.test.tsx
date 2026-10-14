import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { setClinicTimezone } from '@/shared/lib/timezone'
import { renderWithContexts } from '@/test/contexts'
import type { MyDemande, MyDemandes } from '../api/mine'
import { MyDemandesPage } from './MyDemandesPage'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../api/mine', async (o) => ({ ...(await o<typeof import('../api/mine')>()), fetchMyDemandes: mocks.fetch }))

const M = 'modules.demandes.mine'
const I = 'modules.demandes.intake'

beforeAll(() => setClinicTimezone('America/Toronto'))
afterEach(() => vi.clearAllMocks())

const demande = (over: Partial<MyDemande> = {}): MyDemande => ({
  id: 'd1',
  reference: 'DEM-2026-0001',
  received_at: '2026-10-12T14:00:00Z',
  matched_at: '2026-10-14T14:00:00Z',
  beneficiary: 'couple',
  previous_therapy: true,
  language: 'fr',
  modality: 'video',
  availability_periods: ['am', 'evening'],
  availability_days: [1, 5],
  preferred_pro_gender: 'any',
  profession_title_id: 'pt1',
  clientele_id: 'cl1',
  concerns: 'Difficultés de couple',
  payer_kind: 'insurance',
  insurer: 'Desjardins',
  motif_ids: ['m1', 'm2'],
  participants: [
    { client_id: 'c2', display_name: 'Marc Tremblay', relationship: 'partner', is_primary: false },
    { client_id: 'c1', display_name: 'Alice Tremblay', relationship: 'self', is_primary: true },
  ],
  is_urgent: true,
  motif_other: "Deuil d'un animal",
  availability_other: 'Le vendredi midi',
  has_issues: true,
  issues: ['coparenting'],
  issues_comment: 'Garde partagée depuis un an',
  previous_professionals: ['psychologist'],
  previous_comment: 'Suivi il y a deux ans',
  has_legal_context: false,
  legal_context: [],
  legal_detail: null,
  ...over,
})

const DATA = (demandes: MyDemande[]): MyDemandes => ({
  demandes,
  motifs: [
    { id: 'm1', name: 'Communication', sort_order: 1, category_name: 'Couple', category_sort_order: 2 },
    { id: 'm2', name: 'Stress', sort_order: 1, category_name: 'Anxiété', category_sort_order: 1 },
  ],
  clienteles: new Map([['cl1', 'Couples']]),
  titles: new Map([['pt1', 'Psychothérapeute']]),
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{renderWithContexts(<MyDemandesPage />, { path: '/mes-demandes' })}</QueryClientProvider>)
}

/** The value next to a label in the card's description lists. */
function valueOf(card: HTMLElement, label: string): string {
  const term = within(card).getByText(label, { selector: 'dt' })
  return term.nextElementSibling?.textContent ?? ''
}

describe('« Mes demandes » (R-80)', () => {
  it('shows each matched request whole: « Autre motif », « Autres disponibilités », the follow-ups and their comments', async () => {
    mocks.fetch.mockResolvedValue(DATA([demande()]))
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: t(`${M}.title`) })).toBeInTheDocument()
    const card = (await screen.findByRole('heading', { name: 'DEM-2026-0001 · Alice Tremblay' })).closest('section')!
    expect(within(card).getByText(/Reçue le 12 oct\. 2026, jumelée le 14 oct\. 2026/)).toBeInTheDocument()
    expect(within(card).getByText(t(`${I}.need.urgent`))).toBeInTheDocument()
    expect(valueOf(card, t(`${I}.need.motifs`))).toBe('Anxiété : StressCouple : Communication')
    expect(valueOf(card, t(`${I}.need.motifOther`))).toBe("Deuil d'un animal")
    expect(valueOf(card, t(`${I}.prefs.availabilityOther`))).toBe('Le vendredi midi')
    expect(valueOf(card, t(`${I}.need.issues`))).toBe('Oui : Coparentalité')
    expect(valueOf(card, t(`${I}.need.issuesComment`))).toBe('Garde partagée depuis un an')
    expect(valueOf(card, t(`${I}.need.previousTherapy`))).toBe('Oui : Psychologue')
    expect(valueOf(card, t(`${I}.need.previousComment`))).toBe('Suivi il y a deux ans')
    expect(valueOf(card, t(`${I}.need.legal`))).toBe('Non')
    // « Non » holds no follow-up: no « Précisions » row for it.
    expect(within(card).queryByText(t(`${I}.need.legalDetail`))).not.toBeInTheDocument()
    expect(valueOf(card, t(`${M}.people`))).toBe('Marc Tremblay (Conjoint ou conjointe)Alice Tremblay (La personne elle-même)')
    expect(valueOf(card, t(`${I}.need.title_`))).toBe('Psychothérapeute')
    expect(valueOf(card, t(`${I}.need.clientele`))).toBe('Couples')
    expect(valueOf(card, t(`${I}.prefs.periods`))).toBe('Matin, Soir')
    expect(valueOf(card, t(`${I}.prefs.days`))).toBe('Lundi, Vendredi')
    expect(valueOf(card, t(`${I}.prefs.insurer`))).toBe('Desjardins')
  })

  it('says « Non indiqué » for what was not answered, and nothing urgent when it is not', async () => {
    mocks.fetch.mockResolvedValue(
      DATA([demande({ is_urgent: false, motif_other: null, availability_other: null, has_issues: null, previous_therapy: null, has_legal_context: null })]),
    )
    renderPage()
    const card = (await screen.findByRole('heading', { name: 'DEM-2026-0001 · Alice Tremblay' })).closest('section')!
    expect(within(card).queryByText(t(`${I}.need.urgent`))).not.toBeInTheDocument()
    expect(valueOf(card, t(`${I}.need.motifOther`))).toBe(t('common.notProvided'))
    expect(valueOf(card, t(`${I}.need.issues`))).toBe(t('common.notProvided'))
    expect(within(card).queryByText(t(`${I}.need.issuesComment`))).not.toBeInTheDocument()
  })

  it('none matched: said plainly', async () => {
    mocks.fetch.mockResolvedValue(DATA([]))
    renderPage()
    expect(await screen.findByText(t(`${M}.empty.title`))).toBeInTheDocument()
  })
})

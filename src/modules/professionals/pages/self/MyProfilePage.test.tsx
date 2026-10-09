import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { LocationProbe } from '@/test/LocationProbe'
import { accessForRole } from '@/test/role-fixtures'
import type { ProfessionalRecord } from '../../api/parse'
import type { MySubmission } from '../../api/self'
import { professionalKeys } from '../../hooks/keys'
import { GENDERED_CATALOG, socialWorkerRecord } from '../../test/fixtures-domain'
import { mySubmission } from '../../test/fixtures-questionnaire'
import { setupQueryClient } from '../../test/query-client'
import { MyProfilePage } from './MyProfilePage'

const mocks = vi.hoisted(() => ({
  self: { fetchMyProfessionalRecord: vi.fn(), fetchMySubmission: vi.fn(), fetchMyProfessionalPrivate: vi.fn(), startMyProfileUpdate: vi.fn() },
  catalog: { fetchProfessionalsCatalog: vi.fn() },
}))
vi.mock('../../api/self', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/self')>()), ...mocks.self }))
vi.mock('../../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/catalog')>()), ...mocks.catalog }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const P = 'modules.professionals.myProfile'
const Q = `${P}.questionnaire`

/** Nadia, a social worker (« Travailleuse sociale », P4-342). */
function nadia(over: Partial<ProfessionalRecord['professional']> = {}): ProfessionalRecord {
  const record = socialWorkerRecord('female')
  return { ...record, professional: { ...record.professional, firstName: 'Nadia', lastName: 'Côté', email: 'nadia@exemple.ca', status: 'active', ...over } }
}

let record: ProfessionalRecord | null
let submission: MySubmission | null

function renderPage() {
  const { queryClient, invalidated } = setupQueryClient()
  render(
    renderWithContexts(
      <QueryClientProvider client={queryClient}>
        <MyProfilePage />
        <LocationProbe />
      </QueryClientProvider>,
      { path: '/mon-profil', access: { access: accessForRole('provider') } },
    ),
  )
  return { queryClient, invalidated }
}

beforeEach(() => {
  record = nadia()
  submission = null
  mocks.self.fetchMyProfessionalRecord.mockImplementation(async () => record)
  mocks.self.fetchMySubmission.mockImplementation(async () => submission)
  mocks.self.fetchMyProfessionalPrivate.mockResolvedValue({
    sinLast3: '286',
    businessNumber: null,
    gstNumber: '123456789RT0001',
    qstNumber: null,
    bankInstitution: '815',
    bankTransit: '30000',
    bankAccountLast4: '4567',
  })
  mocks.catalog.fetchProfessionalsCatalog.mockResolvedValue(GENDERED_CATALOG)
})
afterEach(() => vi.clearAllMocks())

describe('MyProfilePage', () => {
  it('links its Documents card to « Mes documents » (4c.6)', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: t(`${P}.documents.link`) })).toHaveAttribute('href', '/mes-documents')
  })

  it('shows her own file in the questionnaire’s words, the title in her form', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: t(`${P}.pageTitle`) })).toBeInTheDocument()
    expect(screen.getByText('Nadia Côté · Travailleuse sociale')).toBeInTheDocument()
    expect(screen.getByText('Travailleuse sociale · OPQ TS04518')).toBeInTheDocument()
    expect(screen.getByText('nadia@exemple.ca')).toBeInTheDocument()
    // The motifs by name, under their category (P4-249), in a subsection (h4) of the matching card (h3).
    expect(screen.getByRole('heading', { level: 3, name: t(`${P}.cards.matching`) })).toBeInTheDocument()
    const matching = screen.getByRole('heading', { level: 4, name: t('modules.professionals.onboarding.sections.motifs') }).parentElement as HTMLElement
    expect(matching).toHaveTextContent('Vie intérieure')
    expect(matching).toHaveTextContent('Anxiété')
    expect(mocks.self.fetchMyProfessionalRecord).toHaveBeenCalledOnce()
  })

  it('shows the tax and bank data with the account and the SIN as masks only', async () => {
    renderPage()
    expect(await screen.findByText(t(`${P}.masks.account`, { last4: '4567' }))).toBeInTheDocument()
    expect(screen.getByText(t(`${P}.masks.sin`, { last3: '286' }))).toBeInTheDocument()
    // Only what get_my_professional_private gives: masks, never a reveal. Started with the page
    // (no waterfall); the tests' client keeps nothing fresh, so the card's mount may read it again.
    expect(mocks.self.fetchMyProfessionalPrivate).toHaveBeenCalled()
  })

  it('shows nothing written for the clinic (no compensation, no staff note), although the record carries the notes', async () => {
    // get_my_professional_record returns both notes (Loi 25, P4-373): the page does not display them.
    record = nadia({ deactivationNote: 'Note interne de la clinique', activationOverrideReason: 'Activée avant la fin du questionnaire' })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: t(`${P}.pageTitle`) })
    expect(screen.getByText('Nadia Côté · Travailleuse sociale')).toBeInTheDocument()
    expect(screen.queryByText(/Note interne de la clinique/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Activée avant la fin du questionnaire/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Rémunération|Retenue|rétention/i)).not.toBeInTheDocument()
  })

  it('« Mettre mon profil à jour »: the sections, at least one, then the questionnaire', async () => {
    mocks.self.startMyProfileUpdate.mockResolvedValue('sub-1')
    const { invalidated } = renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t(`${Q}.update.action`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${P}.update.title`) })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${P}.update.confirm`) }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(t(`${P}.update.required`))
    expect(mocks.self.startMyProfileUpdate).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: t('modules.professionals.onboarding.sections.motifs') }))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: t('modules.professionals.onboarding.sections.portrait') }))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${P}.update.confirm`) }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/mon-profil/questionnaire'))
    // The questionnaire's order, whatever the order of the clicks.
    expect(mocks.self.startMyProfileUpdate).toHaveBeenCalledExactlyOnceWith(['portrait', 'motifs'])
    expect(invalidated()).toEqual(expect.arrayContaining([professionalKeys.mySubmission(), professionalKeys.myRecord()]))
  })

  it('a refusal stays in the dialog', async () => {
    mocks.self.startMyProfileUpdate.mockRejectedValue({ code: 'P0001', message: 'Une soumission est déjà en cours.', hint: 'submission' })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t(`${Q}.update.action`) }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: t('modules.professionals.onboarding.sections.motifs') }))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${P}.update.confirm`) }))
    expect(await within(dialog).findByText('Une soumission est déjà en cours.')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/mon-profil')
  })

  it('a questionnaire open: « Continuer le questionnaire » instead', async () => {
    submission = mySubmission({ kind: 'update', requested_sections: ['motifs'] })
    renderPage()
    expect(await screen.findByText(t(`${Q}.continue.update`))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${Q}.continue.action`) })).toHaveAttribute('href', '/mon-profil/questionnaire')
    expect(screen.queryByRole('button', { name: t(`${Q}.update.action`) })).not.toBeInTheDocument()
  })

  it('a profile sent back: the clinic’s note, and « Corriger mon profil »', async () => {
    submission = mySubmission({ decision_note: 'Précisez vos langues.' })
    renderPage()
    expect(await screen.findByText('Précisez vos langues.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${Q}.returned.action`) })).toHaveAttribute('href', '/mon-profil/questionnaire')
  })

  it('a profile sent: the date in the clinic’s time, waiting for the review', async () => {
    submission = mySubmission({ status: 'submitted', submitted_at: '2026-10-08T14:00:00+00:00' })
    renderPage()
    expect(await screen.findByText(t(`${Q}.sent.onboarding`, { date: 'jeudi 8 octobre 2026' }))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${Q}.update.action`) })).not.toBeInTheDocument()
  })

  it('an inactive file: whom to ask, nothing to start (P4-303)', async () => {
    record = nadia({ status: 'inactive' })
    renderPage()
    expect(await screen.findByText(t(`${Q}.inactive`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${Q}.update.action`) })).not.toBeInTheDocument()
  })

  it('no file linked to the account: says so', async () => {
    record = null
    renderPage()
    expect(await screen.findByText(t(`${P}.noFile.title`))).toBeInTheDocument()
  })
})

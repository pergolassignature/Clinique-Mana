import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { ClientPayer } from '../../../api/parse'
import { CIDS, REFERENCE, summaryFixture } from '../../../test/fixtures'
import { ClientRecordPage } from '../../../pages/ClientRecordPage'

const mocks = vi.hoisted(() => ({
  api: { fetchClientSummary: vi.fn(), fetchClientsReference: vi.fn(), saveClientPayer: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../../api/clients', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const C = 'modules.clients.record.coverage'

/** A PAE the import made from a tag (FP-9): no provider, no coverage, renewed on March 31. */
const STUB: ClientPayer = {
  id: 'cp1',
  kind: 'pae',
  organisationName: null,
  fileNumber: null,
  sessionAmountCents: null,
  maxSessions: null,
  maxAmountCents: null,
  startsOn: null,
  expiresOn: null,
  isActive: true,
  note: null,
  coveragePercent: null,
  renewalMonth: 3,
  renewalDay: 31,
  priorUsedCents: null,
  priorUsedSessions: null,
  priorUsedOn: null,
  isStub: true,
  eventOn: null,
  coverageTiers: [],
}

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <UnsavedChangesProvider>
          <Routes>
            <Route path="clients/:id/:onglet?" element={<ClientRecordPage />} />
          </Routes>
        </UnsavedChangesProvider>,
        { path: `/clients/${CIDS.alice}/assurance-et-payeurs`, access: { access: accessForRole('admin_assistant') } },
      )}
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.api.fetchClientSummary.mockResolvedValue(summaryFixture({ payers: [STUB] }))
  mocks.api.fetchClientsReference.mockResolvedValue(REFERENCE)
  mocks.api.saveClientPayer.mockResolvedValue('cp1')
})
afterEach(() => vi.clearAllMocks())

describe('CoverageTab (FP)', () => {
  it('an imported payer says it is to complete; completed with a covered share, its renewal and the use before the app', async () => {
    const user = userEvent.setup()
    renderTab()
    expect(await screen.findByText(t(`${C}.stubHelp`))).toBeInTheDocument()
    expect(screen.getByText(t(`${C}.renewalEvery`, { day: '31 mars' }))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${C}.edit`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${C}.editPayer`) })
    await user.type(within(dialog).getByLabelText(/^Fournisseur/), 'Fournisseur X')
    await user.selectOptions(within(dialog).getByLabelText(/^Ce que le PAE paie/), 'percent')
    await user.type(within(dialog).getByLabelText(/^Part couverte/), '80')
    await user.type(within(dialog).getByLabelText(/^Montant maximal total/), '800')
    await user.type(within(dialog).getByLabelText(/^Déjà utilisé avant/), '120')
    await user.type(within(dialog).getByLabelText(/^En date du/), '2026-09-30')
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveClientPayer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'cp1',
          kind: 'pae',
          organisationName: 'Fournisseur X',
          sessionAmountCents: null,
          coveragePercent: 80,
          maxAmountCents: 80000,
          renewalMonth: 3,
          renewalDay: 31,
          priorUsedCents: 12000,
          priorUsedOn: '2026-09-30',
        }),
      ),
    )
  })

  it('a use before the app needs its date', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(await screen.findByRole('button', { name: t(`${C}.edit`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${C}.editPayer`) })
    await user.type(within(dialog).getByLabelText(/^Déjà utilisé avant/), '120')
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog).findByText(t(`${C}.invalidPrior`))).toBeInTheDocument()
    expect(mocks.api.saveClientPayer).not.toHaveBeenCalled()
  })

  it('one active payer per kind (FP-12): with IVAC active, a new payer can only be a PAE; with both, no « Ajouter un payeur »', async () => {
    const user = userEvent.setup()
    const ivac: ClientPayer = { ...STUB, id: 'cp2', kind: 'ivac', fileNumber: 'IV-1', isStub: false, renewalMonth: null, renewalDay: null }
    mocks.api.fetchClientSummary.mockResolvedValue(summaryFixture({ payers: [ivac] }))
    renderTab()
    await user.click(await screen.findByRole('button', { name: t(`${C}.addPayer`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${C}.addPayer`) })
    const kinds = within(within(dialog).getByLabelText(/^Type/)).getAllByRole('option').map((o) => o.textContent)
    expect(kinds).toEqual(['PAE'])
  })

  it('… and with an IVAC and a PAE both active, it says how to add another', async () => {
    const ivac: ClientPayer = { ...STUB, id: 'cp2', kind: 'ivac', fileNumber: 'IV-1', isStub: false, renewalMonth: null, renewalDay: null }
    mocks.api.fetchClientSummary.mockResolvedValue(summaryFixture({ payers: [STUB, ivac] }))
    renderTab()
    expect(await screen.findByText(t(`${C}.bothKinds`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${C}.addPayer`) })).not.toBeInTheDocument()
  })

  it('R-85: a PAE agreement\'s tiers, entered in order before the usual coverage, saved, then shown in plain French', async () => {
    const user = userEvent.setup()
    const pae: ClientPayer = { ...STUB, organisationName: 'Fournisseur X', fileNumber: 'PX-1', coveragePercent: 50, isStub: false }
    mocks.api.fetchClientSummary.mockResolvedValue(summaryFixture({ payers: [pae] }))
    renderTab()
    await user.click(await screen.findByRole('button', { name: t(`${C}.edit`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${C}.editPayer`) })
    expect(within(dialog).getByLabelText(/^Ce que le PAE paie$/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: t(`${C}.addTier`) }))
    await user.type(within(dialog).getByLabelText(/^Palier 1 · Séances/), '3')
    await user.type(within(dialog).getByLabelText(/^Palier 1 · Part couverte/), '100')
    await user.click(within(dialog).getByRole('button', { name: t(`${C}.addTier`) }))
    await user.type(within(dialog).getByLabelText(/^Palier 2 · Séances/), '2')
    await user.selectOptions(within(dialog).getByLabelText(/^Palier 2 · Couverture/), 'amount')
    await user.type(within(dialog).getByLabelText(/^Palier 2 · Montant par séance/), '60')
    // With tiers, the usual coverage is what the PAE pays after them.
    expect(within(dialog).getByLabelText(/^Ce que le PAE paie ensuite, après les paliers/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveClientPayer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'cp1',
          coveragePercent: 50,
          eventOn: null,
          coverageTiers: [
            { sessions: 3, coveragePercent: 100, sessionAmountCents: null },
            { sessions: 2, coveragePercent: null, sessionAmountCents: 6000 },
          ],
        }),
      ),
    )
  })

  it('… a tier not readable, or tiers without the coverage that follows them, are refused before saving', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(await screen.findByRole('button', { name: t(`${C}.edit`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${C}.editPayer`) })
    await user.click(within(dialog).getByRole('button', { name: t(`${C}.addTier`) }))
    await user.type(within(dialog).getByLabelText(/^Palier 1 · Séances/), '0')
    await user.type(within(dialog).getByLabelText(/^Palier 1 · Part couverte/), '100')
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog).findByText(t(`${C}.invalidTiers`))).toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText(/^Palier 1 · Séances/))
    await user.type(within(dialog).getByLabelText(/^Palier 1 · Séances/), '3')
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog).findByText(t(`${C}.tiersNeedCoverage`))).toBeInTheDocument()
    // « Retirer » drops the tier: one coverage again.
    await user.click(within(dialog).getByRole('button', { name: t(`${C}.removeTier`, { n: '1' }) }))
    expect(within(dialog).queryByLabelText(/^Palier 1/)).not.toBeInTheDocument()
    expect(mocks.api.saveClientPayer).not.toHaveBeenCalled()
  })

  it('… with tiers, a use before the app in dollars only is refused: its sessions are needed', async () => {
    const user = userEvent.setup()
    const pae: ClientPayer = { ...STUB, organisationName: 'Fournisseur X', fileNumber: 'PX-1', coveragePercent: 50, isStub: false }
    mocks.api.fetchClientSummary.mockResolvedValue(summaryFixture({ payers: [pae] }))
    renderTab()
    await user.click(await screen.findByRole('button', { name: t(`${C}.edit`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${C}.editPayer`) })
    await user.click(within(dialog).getByRole('button', { name: t(`${C}.addTier`) }))
    await user.type(within(dialog).getByLabelText(/^Palier 1 · Séances/), '3')
    await user.type(within(dialog).getByLabelText(/^Palier 1 · Part couverte/), '100')
    await user.type(within(dialog).getByLabelText(/^Déjà utilisé avant/), '120')
    await user.type(within(dialog).getByLabelText(/^En date du/), '2026-09-30')
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog).findByText(t(`${C}.tiersNeedPriorSessions`))).toBeInTheDocument()
    expect(mocks.api.saveClientPayer).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText(/^Séances déjà utilisées/), '2')
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveClientPayer).toHaveBeenCalledWith(expect.objectContaining({ priorUsedCents: 12000, priorUsedSessions: 2, priorUsedOn: '2026-09-30' })),
    )
  })

  it('the card shows a tiered agreement in one line, and an IVAC file its event date', async () => {
    const pae: ClientPayer = {
      ...STUB,
      organisationName: 'Fournisseur X',
      fileNumber: 'PX-1',
      coveragePercent: 50,
      isStub: false,
      coverageTiers: [{ sessions: 3, coveragePercent: 100, sessionAmountCents: null }],
    }
    const ivac: ClientPayer = { ...STUB, id: 'cp2', kind: 'ivac', fileNumber: 'IV-1', isStub: false, renewalMonth: null, renewalDay: null, eventOn: '2026-03-02' }
    mocks.api.fetchClientSummary.mockResolvedValue(summaryFixture({ payers: [pae, ivac] }))
    renderTab()
    expect(await screen.findByText('3 premières séances : 100 % ; ensuite : 50 %')).toBeInTheDocument()
    expect(screen.getByText('2 mars 2026')).toBeInTheDocument()
  })

  it('R-84: an IVAC file\'s event date is entered in its form (a calendar date)', async () => {
    const user = userEvent.setup()
    const ivac: ClientPayer = { ...STUB, id: 'cp2', kind: 'ivac', fileNumber: 'IV-1', isStub: false, renewalMonth: null, renewalDay: null }
    mocks.api.fetchClientSummary.mockResolvedValue(summaryFixture({ payers: [ivac] }))
    renderTab()
    await user.click(await screen.findByRole('button', { name: t(`${C}.edit`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${C}.editPayer`) })
    expect(within(dialog).queryByText(t(`${C}.tiers`))).not.toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/^Date de l’évènement|^Date de l'évènement/), '2026-03-02')
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveClientPayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'cp2', kind: 'ivac', eventOn: '2026-03-02', coverageTiers: [] })),
    )
  })

  it('a share outside 1–100 % is refused before saving', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(await screen.findByRole('button', { name: t(`${C}.edit`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${C}.editPayer`) })
    await user.selectOptions(within(dialog).getByLabelText(/^Ce que le PAE paie/), 'percent')
    await user.type(within(dialog).getByLabelText(/^Part couverte/), '120')
    await user.click(within(dialog).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog).findByText(t(`${C}.invalidPercent`))).toBeInTheDocument()
    expect(mocks.api.saveClientPayer).not.toHaveBeenCalled()
  })
})

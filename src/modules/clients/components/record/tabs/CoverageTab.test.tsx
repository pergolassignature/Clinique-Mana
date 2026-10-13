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
    await user.type(within(dialog).getByLabelText(/^Montant au plus/), '800')
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

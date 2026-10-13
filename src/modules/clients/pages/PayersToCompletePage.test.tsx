import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { PayerToComplete } from '../api/clients'
import { CIDS } from '../test/fixtures'
import { PayersToCompletePage } from './PayersToCompletePage'

const mocks = vi.hoisted(() => ({ api: { fetchPayersToComplete: vi.fn() } }))
vi.mock('../api/clients', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.clients.payersToComplete'

const ROWS: PayerToComplete[] = [
  { clientPayerId: 'cp1', clientId: CIDS.alice, clientName: 'Alice Essai', clientNumber: 1, kind: 'ivac', isStub: true, missing: ['file_number'] },
  { clientPayerId: 'cp2', clientId: CIDS.lea, clientName: 'Léa Essai', clientNumber: 2, kind: 'pae', isStub: false, missing: ['organisation_name', 'coverage'] },
]

function open() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}>{renderWithContexts(<PayersToCompletePage />, { access: { access: accessForRole('admin_assistant') } })}</QueryClientProvider>)
}

beforeEach(() => mocks.api.fetchPayersToComplete.mockResolvedValue(ROWS))
afterEach(() => vi.clearAllMocks())

describe('PayersToCompletePage (FP-9)', () => {
  it('each payer says what is missing, the import’s marked, and opens the dossier’s « Assurance et payeurs »', async () => {
    open()
    const rows = within(await screen.findByRole('table', { name: t(`${S}.title`) })).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Alice Essai')
    expect(rows[1]).toHaveTextContent(t(`${S}.stub`))
    expect(rows[1]).toHaveTextContent(t(`${S}.missing.file_number`))
    expect(within(rows[1]!).getByRole('link', { name: 'Alice Essai' })).toHaveAttribute('href', `/clients/${CIDS.alice}/assurance-et-payeurs`)
    expect(rows[2]).toHaveTextContent(`${t(`${S}.missing.organisation_name`)}, ${t(`${S}.missing.coverage`)}`)
  })

  it('nothing to complete: said plainly', async () => {
    mocks.api.fetchPayersToComplete.mockResolvedValue([])
    open()
    expect(await screen.findByText(t(`${S}.empty`))).toBeInTheDocument()
  })
})

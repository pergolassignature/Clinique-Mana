import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense } from 'react'
import { t } from '@/i18n'
import { UnsavedChangesProvider } from '@/shared/components/UnsavedChangesProvider'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, type FixtureRole } from '@/test/role-fixtures'
import { ClientPicker } from '../../index'
import { CIDS, REFERENCE } from '../../test/fixtures'

const mocks = vi.hoisted(() => ({
  api: { searchClients: vi.fn(), fetchClientsReference: vi.fn(), findClientDuplicates: vi.fn(), createClient: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  navigate: vi.fn(),
}))
vi.mock('../../api/clients', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/clients')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }))

const C = 'modules.clients.create'
const K = 'modules.clients.picker'

beforeEach(() => {
  mocks.api.searchClients.mockResolvedValue([{ id: CIDS.alice, clientNumber: 1, name: 'Alice Tremblay', birthday: null, email: 'alice@exemple.test', mobile: null, isArchived: false }])
  mocks.api.fetchClientsReference.mockResolvedValue(REFERENCE)
  mocks.api.findClientDuplicates.mockResolvedValue([])
  mocks.api.createClient.mockResolvedValue('new-id')
})
afterEach(() => vi.clearAllMocks())

function renderPicker(props: Partial<Parameters<typeof ClientPicker>[0]> = {}, role: FixtureRole = 'counselor') {
  const onSelect = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <UnsavedChangesProvider>
          <Suspense fallback={<p>…</p>}>
            <ClientPicker onSelect={onSelect} {...props} />
          </Suspense>
        </UnsavedChangesProvider>,
        { access: { access: accessForRole(role) } },
      )}
    </QueryClientProvider>,
  )
  return onSelect
}

describe('ClientPicker (for other modules)', () => {
  it('a search result returns its id, never navigates', async () => {
    const user = userEvent.setup()
    const onSelect = renderPicker()
    await user.type(await screen.findByRole('searchbox', { name: /^Client/ }, { timeout: 5000 }), 'trem')
    await user.click(await within(screen.getByRole('list', { name: t(`${K}.results`) })).findByRole('button', { name: /Alice Tremblay/ }))
    expect(onSelect).toHaveBeenCalledWith(CIDS.alice, { id: CIDS.alice, name: 'Alice Tremblay', clientNumber: 1 })
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('« Nouveau client » returns the new id through onCreated, prefilled with what the caller has', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    renderPicker({ onCreated, initialValues: { firstName: 'Zoé', lastName: 'Roy' } })
    await user.click(await screen.findByRole('button', { name: t(`${C}.add`) }))
    const sheet = await screen.findByRole('dialog', { name: t(`${C}.title`) })
    expect(within(sheet).getByRole('textbox', { name: /^Prénom/ })).toHaveValue('Zoé')
    await user.click(within(sheet).getByRole('button', { name: t(`${C}.submit`) }))
    await waitFor(() => expect(mocks.api.createClient).toHaveBeenCalled())
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-id'))
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('a similar file in the creation sheet can be chosen instead', async () => {
    const user = userEvent.setup()
    mocks.api.findClientDuplicates.mockResolvedValue([
      { clientId: CIDS.alice, level: 'high', reasons: ['email'], clientNumber: 1, displayName: 'Alice Tremblay', birthday: null, email: null, mobile: null, isArchived: false },
    ])
    const onSelect = renderPicker({ initialValues: { firstName: 'Alice', lastName: 'Tremblay' } })
    await user.click(await screen.findByRole('button', { name: t(`${C}.add`) }))
    const sheet = await screen.findByRole('dialog', { name: t(`${C}.title`) })
    await user.click(await within(sheet).findByRole('button', { name: t(`${C}.duplicates.pick`) }))
    expect(onSelect).toHaveBeenCalledWith(CIDS.alice, null)
  })

  it('no « Nouveau client » without clients.manage', async () => {
    renderPicker({}, 'provider')
    await screen.findByRole('searchbox', { name: /^Client/ })
    expect(screen.queryByRole('button', { name: t(`${C}.add`) })).not.toBeInTheDocument()
  })
})

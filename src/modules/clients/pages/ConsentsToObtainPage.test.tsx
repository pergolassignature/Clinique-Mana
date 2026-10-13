import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import { TEMPLATES, TYPES, statusOf, toObtain } from '../test/consent-fixtures'
import { ConsentsToObtainPage } from './ConsentsToObtainPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchConsentsToObtain: vi.fn(),
    fetchConsentTypes: vi.fn(),
    fetchConsentTemplates: vi.fn(),
    fetchClientConsentStatus: vi.fn(),
    fetchClientConsentFiles: vi.fn(),
    sendConsentRequest: vi.fn(),
    resendConsentRequest: vi.fn(),
    cancelConsentRequest: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  storage: { fetchStoredFile: vi.fn() },
  saveBlob: vi.fn(),
}))
vi.mock('@/core/storage/api', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.storage }))
vi.mock('@/shared/lib/files', async (importOriginal) => ({ ...(await importOriginal<object>()), saveBlob: mocks.saveBlob }))
vi.mock('../api/consents', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.clients.consents'

beforeEach(() => {
  mocks.api.fetchConsentsToObtain.mockResolvedValue({
    rows: [
      toObtain({ requestId: 'q1', clientName: 'Alex Retard', isOverdue: true }),
      toObtain({ requestId: 'q2', clientId: 'c2', clientName: 'Camille Test', answered: true, remindedAt: '2026-10-17T12:00:00Z' }),
      toObtain({ requestId: 'q3', clientId: 'c3', clientName: 'Dominique Signe', signingStatus: 'viewed', dueAt: null }),
    ],
    total: 3,
  })
  mocks.api.fetchConsentTypes.mockResolvedValue(TYPES)
  mocks.api.fetchConsentTemplates.mockResolvedValue(TEMPLATES)
  mocks.api.fetchClientConsentStatus.mockResolvedValue([
    statusOf({ consentKey: 'general', state: 'pending', requestId: 'q2', lastSentAt: '2026-10-10T14:00:00Z' }),
  ])
  mocks.api.fetchClientConsentFiles.mockResolvedValue({})
  mocks.api.resendConsentRequest.mockResolvedValue({ request_id: 'q2', resent: true, signers: [{ role: 'client', sent: true }] })
  mocks.api.sendConsentRequest.mockResolvedValue({ request_id: 'q9', resent: false, signers: [{ role: 'client', sent: false, code: 'provider_error' }] })
  mocks.api.cancelConsentRequest.mockResolvedValue(undefined)
})
afterEach(() => vi.clearAllMocks())

function renderPage(role: 'admin' | 'counselor' = 'admin', permissions?: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole(role, { modules: ['professionals', 'clients'], ...(permissions && { permissions }) })
  render(<QueryClientProvider client={queryClient}>{renderWithContexts(<ConsentsToObtainPage />, { access: { access }, path: '/clients/consentements' })}</QueryClientProvider>)
}

describe('ConsentsToObtainPage', () => {
  it('one row per open request, its state in words', async () => {
    renderPage()
    const table = await screen.findByRole('table', { name: t(`${S}.title`) })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText(t(`${S}.state.overdue`))).toBeInTheDocument()
    expect(within(rows[1]!).getByText(t(`${S}.progress.answered`))).toBeInTheDocument()
    expect(within(rows[1]!).getByText(new RegExp(t(`${S}.reminded`)))).toBeInTheDocument()
    expect(within(rows[2]!).getByText(t(`${S}.progress.signing`))).toBeInTheDocument()
    expect(within(rows[2]!).getByText(t(`${S}.noDue`))).toBeInTheDocument()
  })

  it('the count is the total, even past the rows shown', async () => {
    mocks.api.fetchConsentsToObtain.mockResolvedValue({ rows: [toObtain()], total: 612 })
    renderPage()
    expect(await screen.findByText('612')).toBeInTheDocument()
  })

  it('a signed consent: its date and version, its sealed PDF downloaded in one press', async () => {
    mocks.api.fetchClientConsentStatus.mockResolvedValue([
      statusOf({ consentKey: 'general', state: 'signed', signedAt: '2026-10-11T14:00:00Z', versionLabel: 'version 1' }),
      statusOf({ consentKey: 'waitlist', state: 'signed', signedAt: '2026-10-11T14:00:00Z', versionLabel: null }),
    ])
    mocks.api.fetchClientConsentFiles.mockResolvedValue({ general: { fileId: 'f1', source: 'app' } })
    mocks.storage.fetchStoredFile.mockResolvedValue(new Uint8Array([37, 80, 68, 70]))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t(`${S}.open`, { client: 'Camille Test' }) }))
    const sheet = await screen.findByRole('dialog', { name: t(`${S}.sheetTitle`, { client: 'Camille Test' }) })
    expect(await within(sheet).findByText(/\(version 1\)$/)).toBeInTheDocument()
    expect(within(sheet).queryByText(/\(\)/)).not.toBeInTheDocument()
    // In force: nothing to send; Liste d'attente (signed too, no version): nothing either.
    expect(within(sheet).queryByRole('button', { name: t(`${S}.send`) })).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.openPdf`) }))
    await waitFor(() => expect(mocks.saveBlob).toHaveBeenCalledOnce())
    expect(mocks.storage.fetchStoredFile).toHaveBeenCalledWith('f1')
  })

  it('the texts failed to load: says so, and no « Texte pas encore publié » nor « Envoyer »', async () => {
    mocks.api.fetchClientConsentStatus.mockResolvedValue([])
    mocks.api.fetchConsentTemplates.mockRejectedValue(new Error('boom'))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t(`${S}.open`, { client: 'Camille Test' }) }))
    const sheet = await screen.findByRole('dialog', { name: t(`${S}.sheetTitle`, { client: 'Camille Test' }) })
    expect(await within(sheet).findByText(t(`${S}.templatesError`))).toBeInTheDocument()
    expect(within(sheet).queryByText(t(`${S}.notPublished`))).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: t(`${S}.send`) })).not.toBeInTheDocument()
  })

  it('nothing to obtain: says so', async () => {
    mocks.api.fetchConsentsToObtain.mockResolvedValue({ rows: [], total: 0 })
    renderPage()
    expect(await screen.findByText(t(`${S}.empty.title`))).toBeInTheDocument()
  })

  it('a row opens the client’s consents; « Renvoyer » sends new links', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t(`${S}.open`, { client: 'Camille Test' }) }))
    const sheet = await screen.findByRole('dialog', { name: t(`${S}.sheetTitle`, { client: 'Camille Test' }) })
    expect(await within(sheet).findByText(t(`${S}.state.pending`))).toBeInTheDocument()
    expect(mocks.api.fetchClientConsentStatus).toHaveBeenCalledWith('c2')
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.resend`) }))
    await waitFor(() => expect(mocks.api.resendConsentRequest).toHaveBeenCalledExactlyOnceWith('q2'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.sent`))
  })

  it('« Annuler la demande » asks first', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t(`${S}.open`, { client: 'Camille Test' }) }))
    const sheet = await screen.findByRole('dialog', { name: t(`${S}.sheetTitle`, { client: 'Camille Test' }) })
    await userEvent.click(await within(sheet).findByRole('button', { name: t(`${S}.cancel`) }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(t(`${S}.cancelConfirm`))).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${S}.cancel`) }))
    await waitFor(() => expect(mocks.api.cancelConsentRequest).toHaveBeenCalledExactlyOnceWith('q2'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.cancelled`))
  })

  it('« Envoyer » a published consent; an email that did not leave says « Renvoyer »; a refusal is shown as written', async () => {
    mocks.api.fetchClientConsentStatus.mockResolvedValue([])
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t(`${S}.open`, { client: 'Camille Test' }) }))
    const sheet = await screen.findByRole('dialog', { name: t(`${S}.sheetTitle`, { client: 'Camille Test' }) })
    // Général is published; Liste d'attente is not (no « Envoyer »); PAE is inactive (not listed).
    const send = await within(sheet).findAllByRole('button', { name: t(`${S}.send`) })
    expect(send).toHaveLength(1)
    expect(within(sheet).getByText(t(`${S}.notPublished`))).toBeInTheDocument()
    expect(within(sheet).queryByText('PAE')).not.toBeInTheDocument()
    await userEvent.click(send[0]!)
    await waitFor(() => expect(mocks.api.sendConsentRequest).toHaveBeenCalledExactlyOnceWith('c2', 'general'))
    expect(mocks.toast.warning).toHaveBeenCalledWith(t(`${S}.sentPartly`))

    mocks.api.sendConsentRequest.mockRejectedValue(
      new FunctionCallError('invalid_request', 400, 'Ce client a moins de 14 ans : un parent ou un tuteur doit signer.', { refusal: true }),
    )
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${S}.send`) }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringContaining('Ce client a moins de 14 ans')))
  })

  it('without clients.manage: the states, no action', async () => {
    renderPage('admin', ['clients.view'])
    await userEvent.click(await screen.findByRole('button', { name: t(`${S}.open`, { client: 'Camille Test' }) }))
    const sheet = await screen.findByRole('dialog', { name: t(`${S}.sheetTitle`, { client: 'Camille Test' }) })
    expect(await within(sheet).findByText(t(`${S}.state.pending`))).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: t(`${S}.resend`) })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: t(`${S}.cancel`) })).not.toBeInTheDocument()
  })
})

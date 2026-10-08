import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { EmailLogRow } from '@/core/email/api'
import { renderWithContexts } from '@/test/contexts'
import { EmailLogTable } from './EmailLogTable'

const mocks = vi.hoisted(() => ({
  api: { listEmailLog: vi.fn(), listEmailTemplates: vi.fn(), EMAIL_LOG_PAGE_SIZE: 2 },
}))
vi.mock('@/core/email/api', () => mocks.api)

afterEach(() => {
  vi.resetAllMocks()
  mocks.api.EMAIL_LOG_PAGE_SIZE = 2
})

const row = (overrides: Partial<EmailLogRow>): EmailLogRow => ({
  id: 'e1',
  template_key: 'core.staff_invite',
  template_label: "Invitation d'un membre du personnel",
  status: 'delivered',
  to_email: 'marie@exemple.ca',
  subject_type: 'staff_invitation',
  subject_id: 'f1',
  // 08:00 in the clinic (America/Toronto, EDT).
  created_at: '2026-10-08T12:00:00Z',
  sent_at: '2026-10-08T12:00:01Z',
  last_event_at: '2026-10-08T12:00:05Z',
  error_code: null,
  ...overrides,
})
const DELIVERED = row({ id: 'e1' })
const BOUNCED = row({ id: 'e2', status: 'bounced', created_at: '2026-10-07T12:00:00Z' })
const ANONYMISED_FAILED = row({ id: 'e3', status: 'failed', to_email: null, error_code: 'provider_unavailable', created_at: '2024-01-07T12:00:00Z' })

function renderLog(pages: EmailLogRow[][] = [[DELIVERED, BOUNCED], [ANONYMISED_FAILED]]) {
  for (const page of pages) mocks.api.listEmailLog.mockResolvedValueOnce(page)
  mocks.api.listEmailLog.mockResolvedValue([])
  mocks.api.listEmailTemplates.mockResolvedValue([
    { key: 'core.staff_invite', label: "Invitation d'un membre du personnel", module_key: 'core' },
  ])
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{renderWithContexts(<EmailLogTable />)}</QueryClientProvider>)
}

/** Testing Library reads non-breaking spaces as spaces. */
const plain = (text: string) => text.replace(/\u00a0/g, ' ')
const table = () => screen.getByRole('table', { name: t('settings.email.log.title') })
const rowOf = (text: string) => within(table()).getByRole('row', { name: new RegExp(text) })

describe('EmailLogTable', () => {
  it('loads the log and the template list in parallel', () => {
    mocks.api.listEmailLog.mockReturnValue(new Promise(() => {}))
    mocks.api.listEmailTemplates.mockReturnValue(new Promise(() => {}))
    render(<QueryClientProvider client={new QueryClient()}>{renderWithContexts(<EmailLogTable />)}</QueryClientProvider>)
    expect(mocks.api.listEmailLog).toHaveBeenCalledExactlyOnceWith({ templateKey: null, status: null, from: null }, null)
    expect(mocks.api.listEmailTemplates).toHaveBeenCalledTimes(1)
  })

  it('lists date, template, recipient and status in French', async () => {
    renderLog()
    await within(await screen.findByRole('table', { name: t('settings.email.log.title') })).findByText('08 oct. 2026 à 08:00')
    const delivered = rowOf('08 oct. 2026 à 08:00')
    expect(within(delivered).getByText("Invitation d'un membre du personnel")).toBeInTheDocument()
    // Its own column, and repeated under the template on a phone.
    expect(within(delivered).getAllByText('marie@exemple.ca')).toHaveLength(2)
    expect(within(delivered).getByText('Livré')).toBeInTheDocument()
  })

  it('reads a bounced email as « Adresse introuvable »', async () => {
    renderLog()
    await screen.findByText('07 oct. 2026 à 08:00')
    expect(within(rowOf('07 oct. 2026 à 08:00')).getByText('Adresse introuvable')).toBeInTheDocument()
  })

  it('« Charger plus » asks for the rows before the last one seen (both cursor fields), then shows the end', async () => {
    const user = userEvent.setup()
    renderLog()
    await screen.findByText('07 oct. 2026 à 08:00')
    await user.click(screen.getByRole('button', { name: t('settings.email.log.loadMore') }))
    await screen.findByText('07 janv. 2024 à 07:00')
    expect(mocks.api.listEmailLog).toHaveBeenLastCalledWith(
      { templateKey: null, status: null, from: null },
      { before: BOUNCED.created_at, beforeId: BOUNCED.id },
    )
    // Anonymised after 24 months; failed, but the provider may have accepted it: not « Échec ».
    const failed = rowOf('07 janv. 2024')
    expect(within(failed).getAllByText('Adresse retirée')).toHaveLength(2)
    expect(within(failed).getByText('Résultat inconnu')).toBeInTheDocument()
    expect(within(failed).getByText(plain(t('email.failure.unknownOutcomeHint')))).toBeInTheDocument()
    expect(within(failed).queryByText('Échec')).not.toBeInTheDocument()
    expect(within(failed).queryByText(/^Code/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('settings.email.log.loadMore') })).not.toBeInTheDocument()
    expect(screen.getByText(t('settings.email.log.end'))).toBeInTheDocument()
  })

  it('names a known failure, and shows the code of an unknown one only', async () => {
    renderLog([
      [
        row({ id: 'f1', status: 'failed', error_code: 'invalid_recipient', created_at: '2026-10-08T12:00:00Z' }),
        row({ id: 'f2', status: 'failed', error_code: 'something_new', created_at: '2026-10-07T12:00:00Z' }),
      ],
    ])
    await screen.findByText('08 oct. 2026 à 08:00')
    const known = rowOf('08 oct. 2026 à 08:00')
    expect(within(known).getByText('Adresse invalide')).toBeInTheDocument()
    expect(within(known).queryByText(/^Code/)).not.toBeInTheDocument()
    const unknown = rowOf('07 oct. 2026 à 08:00')
    expect(within(unknown).getByText('Échec')).toBeInTheDocument()
    expect(within(unknown).getByText(/^Code.:.something_new$/)).toBeInTheDocument()
  })

  it('says why the template filter is empty when the template list fails', async () => {
    mocks.api.listEmailLog.mockResolvedValue([DELIVERED])
    mocks.api.listEmailTemplates.mockRejectedValue(new Error('boom'))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}>{renderWithContexts(<EmailLogTable />)}</QueryClientProvider>)
    const hint = plain(t('settings.email.log.filters.templatesError'))
    expect(await screen.findByText(hint)).toBeInTheDocument()
    expect(screen.getByLabelText(t('settings.email.log.filters.template'))).toHaveAccessibleDescription(t('settings.email.log.filters.templatesError'))
    // The log itself still loads.
    expect(await screen.findByText('08 oct. 2026 à 08:00')).toBeInTheDocument()
  })

  it('filters by template and status, from the first page again', async () => {
    const user = userEvent.setup()
    renderLog()
    await screen.findByText('07 oct. 2026 à 08:00')
    await user.selectOptions(screen.getByLabelText(t('settings.email.log.filters.status')), 'bounced')
    await waitFor(() =>
      expect(mocks.api.listEmailLog).toHaveBeenLastCalledWith({ templateKey: null, status: 'bounced', from: null }, null),
    )
    await user.selectOptions(screen.getByLabelText(t('settings.email.log.filters.template')), 'core.staff_invite')
    await waitFor(() =>
      expect(mocks.api.listEmailLog).toHaveBeenLastCalledWith({ templateKey: 'core.staff_invite', status: 'bounced', from: null }, null),
    )
  })

  it('filters by period from the clinic’s midnight', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-10-08T16:00:00Z') })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderLog()
    await screen.findByText('07 oct. 2026 à 08:00')
    await user.selectOptions(screen.getByLabelText(t('settings.email.log.filters.period')), '7d')
    // 2 Oct 2026, 00:00 in Toronto (EDT) = 04:00 UTC.
    await waitFor(() =>
      expect(mocks.api.listEmailLog).toHaveBeenLastCalledWith({ templateKey: null, status: null, from: '2026-10-02T04:00:00.000Z' }, null),
    )
    vi.useRealTimers()
  })

  it('says so when nothing was sent', async () => {
    renderLog([[]])
    expect(await screen.findByText(t('settings.email.log.empty.title'))).toBeInTheDocument()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Route, Routes } from 'react-router-dom'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import { MAILBOX } from '../test/fixtures'
import { communicationsManifest } from '../manifest'
import { ClientMailPanel } from './ClientMailPanel'

const mocks = vi.hoisted(() => ({
  composer: {
    getComposeContext: vi.fn(),
    listClientThreads: vi.fn(),
    listTemplates: vi.fn(),
    saveDraft: vi.fn(),
  },
  mailboxes: { listMailConnections: vi.fn() },
}))
vi.mock('../api/composer', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/composer')>()), ...mocks.composer }))
vi.mock('../api/mailboxes', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/mailboxes')>()), ...mocks.mailboxes }))
vi.mock('../components/composer/RichEmailEditor', () => ({
  RichEmailEditor: ({ initialHtml, label }: { initialHtml: string; label: string }) => <textarea aria-label={label} defaultValue={initialHtml} />,
}))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const P = 'modules.communications.clientPanel'
const CLIENT = 'd0000000-0000-0000-0000-000000000001'

beforeEach(() => {
  mocks.mailboxes.listMailConnections.mockResolvedValue([MAILBOX])
  mocks.composer.getComposeContext.mockResolvedValue({
    client: { id: CLIENT, client_number: 42, display_name: 'Alice Exemple' },
    recipients: [{ email: 'alice@exemple.test', name: 'Alice Exemple', is_self: true, relation_type: null }],
  })
  mocks.composer.listClientThreads.mockResolvedValue([
    {
      id: 't1',
      connection_id: MAILBOX.id,
      subject: 'Demande de rendez-vous',
      snippet: 'Bonjour',
      last_from_name: 'Alice Exemple',
      last_from_address: 'alice@exemple.test',
      last_message_at: '2026-10-12T14:00:00Z',
      message_count: 2,
      unread_count: 1,
      link_source: 'auto',
    },
  ])
  mocks.composer.listTemplates.mockResolvedValue([])
  mocks.composer.saveDraft.mockResolvedValue({ id: 'd1', updatedAt: '2026-10-13T15:00:00Z' })
})
afterEach(() => vi.clearAllMocks())

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole('counselor', { modules: ['communications', 'clients'] })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Routes>
          <Route path="/clients/:id/:onglet" element={<ClientMailPanel />} />
        </Routes>,
        { access: { access }, path: `/clients/${CLIENT}/courriels` },
      )}
    </QueryClientProvider>,
  )
}

describe('ClientMailPanel', () => {
  it('is Communications’ panel in Clients’ « Courriels », for communications.inbox', () => {
    expect(communicationsManifest.slots?.['client.messages']?.map((p) => [p.id, p.permissions])).toEqual([
      ['communications.mail', ['communications.inbox']],
      ['communications.sms', ['communications.sms']],
    ])
  })

  it('lists the threads linked to the file, each opening in « Courriels »', async () => {
    renderPanel()
    const list = await screen.findByRole('list', { name: t(`${P}.title`) })
    expect(within(list).getByRole('link', { name: 'Demande de rendez-vous' })).toHaveAttribute('href', `/courriels?boite=${MAILBOX.id}&fil=t1`)
    expect(within(list).getByText(new RegExp(t(`${P}.messagesOther`, { count: '2' })))).toBeInTheDocument()
    expect(mocks.composer.listClientThreads).toHaveBeenCalledWith(CLIENT)
  })

  it('« Écrire un courriel » opens the composer to the file’s address, about the file', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', { name: t(`${P}.write`) }))
    const composer = await screen.findByRole('dialog', { name: t('modules.communications.composer.titleNew') })
    expect(within(composer).getByLabelText(t('modules.communications.composer.to'))).toHaveValue('alice@exemple.test')
    expect(within(composer).getByText(t('modules.communications.composer.aboutFile', { file: 'CLI-000042 · Alice Exemple' }))).toBeInTheDocument()
  })

  it('without a connected mailbox, says who connects one', async () => {
    mocks.mailboxes.listMailConnections.mockResolvedValue([])
    renderPanel()
    expect(await screen.findByText(t(`${P}.noMailbox`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${P}.write`) })).not.toBeInTheDocument()
  })
})

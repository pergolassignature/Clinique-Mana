import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { MailAttachment, MailMessage, MailThread, MailThreadRow } from '../api/inbox'
import { MAILBOX } from '../test/fixtures'
import { InboxPage } from './InboxPage'

const mocks = vi.hoisted(() => ({
  inbox: {
    listMailThreads: vi.fn(),
    getMailThread: vi.fn(),
    listMailLabels: vi.fn(),
    modifyMailThreads: vi.fn(),
  },
  mailboxes: { listMailConnections: vi.fn() },
  storage: {
    useSignedFileUrl: vi.fn(),
    useSignedFileUrls: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/inbox', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/inbox')>()), ...mocks.inbox }))
vi.mock('../api/mailboxes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/mailboxes')>()),
  ...mocks.mailboxes,
}))
vi.mock('@/core/storage/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/storage/hooks')>()),
  ...mocks.storage,
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const I = 'modules.communications.inbox'
const T1 = 'a0000000-0000-0000-0000-000000000001'
const T2 = 'a0000000-0000-0000-0000-000000000002'

const row = (over: Partial<MailThreadRow> = {}): MailThreadRow => ({
  id: T1,
  connection_id: MAILBOX.id,
  gmail_thread_id: '18c0001',
  subject: 'Demande de rendez-vous',
  snippet: 'Bonjour, je voudrais un rendez-vous',
  last_from_name: 'Alice Exemple',
  last_from_address: 'alice@exemple.test',
  last_message_at: '2026-10-12T14:00:00Z',
  message_count: 2,
  unread_count: 1,
  has_attachments: true,
  label_ids: ['INBOX', 'UNREAD'],
  link_status: 'unlinked',
  ...over,
})

const attachment = (over: Partial<MailAttachment> = {}): MailAttachment => ({
  id: 'att1',
  filename: 'recu.pdf',
  mime_type: 'application/pdf',
  size_bytes: 20_480,
  content_id: null,
  is_inline: false,
  status: 'stored',
  stored_file_id: 'f0000000-0000-0000-0000-000000000001',
  ...over,
})

const message = (over: Partial<MailMessage> = {}): MailMessage => ({
  id: 'm1',
  gmail_message_id: 'g1',
  from_name: 'Alice Exemple',
  from_address: 'alice@exemple.test',
  to: [{ name: null, address: 'info@clinique.test' }],
  cc: [],
  reply_to_address: null,
  subject: 'Demande de rendez-vous',
  snippet: 'Premier message',
  sent_at: '2026-10-11T14:00:00Z',
  label_ids: ['INBOX'],
  is_unread: false,
  is_inbound: true,
  body_html: null,
  body_text: 'Premier message, déjà lu.',
  body_purged: false,
  attachments: [],
  ...over,
})

const thread = (over: Partial<MailThread> = {}): MailThread => ({
  id: T1,
  connection_id: MAILBOX.id,
  mailbox: MAILBOX.email_address,
  gmail_thread_id: '18c0001',
  subject: 'Demande de rendez-vous',
  label_ids: ['INBOX', 'UNREAD'],
  message_count: 2,
  unread_count: 1,
  link_status: 'unlinked',
  messages: [
    message(),
    message({
      id: 'm2',
      gmail_message_id: 'g2',
      snippet: 'Second message',
      sent_at: '2026-10-12T14:00:00Z',
      is_unread: true,
      body_text: 'Bonjour, je voudrais un rendez-vous mardi.',
      attachments: [
        attachment(),
        attachment({ id: 'att2', filename: 'dossier.zip', status: 'unsupported_type', stored_file_id: null, size_bytes: 3_000_000 }),
      ],
    }),
  ],
  ...over,
})

beforeEach(() => {
  mocks.mailboxes.listMailConnections.mockResolvedValue([MAILBOX])
  mocks.inbox.listMailThreads.mockResolvedValue([
    row(),
    row({ id: T2, subject: 'Facture', unread_count: 0, label_ids: ['INBOX', 'STARRED'], has_attachments: false, message_count: 1 }),
  ])
  mocks.inbox.getMailThread.mockResolvedValue(thread())
  mocks.inbox.listMailLabels.mockResolvedValue([
    { gmail_label_id: 'Label_1', name: 'Factures', type: 'user', visibility: null, color_background: null },
  ])
  mocks.inbox.modifyMailThreads.mockResolvedValue(1)
  mocks.storage.useSignedFileUrl.mockImplementation((id: string | null) => ({
    data: id ? { url: `https://storage.test/${id}` } : undefined,
  }))
  mocks.storage.useSignedFileUrls.mockReturnValue({ urls: new Map(), refetchFor: vi.fn() })
})
afterEach(() => vi.clearAllMocks())

function renderPage(path = '/courriels') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole('counselor', { modules: ['communications'] })
  render(<QueryClientProvider client={queryClient}>{renderWithContexts(<InboxPage />, { access: { access }, path })}</QueryClientProvider>)
  return queryClient
}

describe('InboxPage', () => {
  it('lists the inbox of the first mailbox, newest first, with unread, starred and attachments marked', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: t(`${I}.title`) })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: t(`${I}.list.label`) })
    const rows = within(list).getAllByRole('button')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Alice Exemple')
    expect(rows[0]).toHaveTextContent(t(`${I}.list.unread`))
    expect(within(rows[0]!).getByLabelText(t(`${I}.list.attachments`))).toBeInTheDocument()
    expect(within(rows[1]!).getByLabelText(t(`${I}.list.starred`))).toBeInTheDocument()
    expect(mocks.inbox.listMailThreads).toHaveBeenCalledWith(
      { connectionId: MAILBOX.id, view: 'inbox', labelId: null, search: '' },
      null,
    )
    // The views, the unread count, the mailbox's own labels.
    const nav = screen.getByRole('navigation', { name: t(`${I}.nav.label`) })
    expect(within(nav).getByRole('button', { name: new RegExp(t(`${I}.nav.views.inbox`)) })).toHaveAttribute('aria-current', 'true')
    expect(within(nav).getByRole('button', { name: new RegExp(t(`${I}.nav.views.inbox`)) })).toHaveTextContent('2')
    expect(await within(nav).findByRole('button', { name: 'Factures' })).toBeInTheDocument()
    expect(screen.getByText(t(`${I}.thread.select`))).toBeInTheDocument()
  })

  it('opens a thread: the unread and latest messages open, the others folded; marks it read once, silently', async () => {
    const user = userEvent.setup()
    renderPage()
    const list = await screen.findByRole('list', { name: t(`${I}.list.label`) })
    await user.click(within(list).getAllByRole('button')[0]!)
    expect(await screen.findByRole('heading', { level: 2, name: 'Demande de rendez-vous' })).toHaveFocus()
    expect(screen.getByText('Bonjour, je voudrais un rendez-vous mardi.')).toBeInTheDocument()
    // The read one is folded to a line; a click opens it.
    expect(screen.queryByText('Premier message, déjà lu.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Premier message/ }))
    expect(screen.getByText('Premier message, déjà lu.')).toBeInTheDocument()
    await waitFor(() => expect(mocks.inbox.modifyMailThreads).toHaveBeenCalledTimes(1))
    expect(mocks.inbox.modifyMailThreads).toHaveBeenCalledWith([T1], { kind: 'read' })
    // The stored attachment opens through its signed URL; the other points to Gmail.
    expect(screen.getByRole('link', { name: /recu\.pdf/ })).toHaveAttribute('href', 'https://storage.test/f0000000-0000-0000-0000-000000000001')
    expect(mocks.storage.useSignedFileUrl).toHaveBeenCalledWith('f0000000-0000-0000-0000-000000000001', { refresh: true })
    expect(screen.getByText(/dossier\.zip/)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(t(`${I}.thread.attachmentInGmail`)))).toBeInTheDocument()
  })

  it('archives at once (optimistic) and puts the thread back when Gmail refuses, with a French toast', async () => {
    const user = userEvent.setup()
    mocks.inbox.getMailThread.mockResolvedValue(thread({ unread_count: 0, label_ids: ['INBOX'] }))
    let refuse: (error: unknown) => void = () => {}
    mocks.inbox.modifyMailThreads.mockImplementation(() => new Promise((_resolve, reject) => (refuse = reject)))
    renderPage(`/courriels?fil=${T1}`)
    const archive = await screen.findByRole('button', { name: t(`${I}.thread.archive`) })
    await user.click(archive)
    expect(mocks.inbox.modifyMailThreads).toHaveBeenCalledWith([T1], { kind: 'archive' })
    // Out of the inbox at once: the action offers the way back.
    expect(await screen.findByRole('button', { name: t(`${I}.thread.toInbox`) })).toBeInTheDocument()
    refuse(new FunctionCallError('provider_error', 502, 'Gmail refused'))
    expect(await screen.findByRole('button', { name: t(`${I}.thread.archive`) })).toBeInTheDocument()
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledTimes(1))
  })

  it('stars and labels through gmail-modify', async () => {
    const user = userEvent.setup()
    // Gmail's answer: read again after the action, the thread is starred.
    mocks.inbox.getMailThread
      .mockResolvedValueOnce(thread({ unread_count: 0, label_ids: ['INBOX'] }))
      .mockResolvedValue(thread({ unread_count: 0, label_ids: ['INBOX', 'STARRED'] }))
    renderPage(`/courriels?fil=${T1}`)
    await user.click(await screen.findByRole('button', { name: t(`${I}.thread.star`) }))
    expect(mocks.inbox.modifyMailThreads).toHaveBeenLastCalledWith([T1], { kind: 'star' })
    expect(await screen.findByRole('button', { name: t(`${I}.thread.unstar`) })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: t(`${I}.thread.labels`) }))
    await user.click(await screen.findByRole('menuitem', { name: /Factures/ }))
    expect(mocks.inbox.modifyMailThreads).toHaveBeenLastCalledWith([T1], { kind: 'label', label_id: 'Label_1' })
  })

  it('searches every view 300 ms after typing, and keeps the query in the address', async () => {
    const user = userEvent.setup()
    renderPage()
    const search = await screen.findByRole('searchbox', { name: t(`${I}.search`) })
    mocks.inbox.listMailThreads.mockResolvedValue([])
    await user.type(search, 'facture')
    await waitFor(() =>
      expect(mocks.inbox.listMailThreads).toHaveBeenLastCalledWith(
        { connectionId: MAILBOX.id, view: 'all', labelId: null, search: 'facture' },
        null,
      ),
    )
    expect(await screen.findByText(t(`${I}.list.noResult`))).toBeInTheDocument()
  })

  it('opens the view named in the address (a label) and a thread from a link', async () => {
    renderPage(`/courriels?vue=libelle:Label_1&fil=${T1}`)
    await waitFor(() =>
      expect(mocks.inbox.listMailThreads).toHaveBeenCalledWith(
        { connectionId: MAILBOX.id, view: 'label', labelId: 'Label_1', search: '' },
        null,
      ),
    )
    expect(await screen.findByRole('heading', { level: 2, name: 'Demande de rendez-vous' })).toBeInTheDocument()
    expect(mocks.inbox.getMailThread).toHaveBeenCalledWith(T1)
  })

  it('says when the thread is gone', async () => {
    mocks.inbox.getMailThread.mockResolvedValue(null)
    renderPage(`/courriels?fil=${T2}`)
    expect(await screen.findByText(t(`${I}.thread.gone`))).toBeInTheDocument()
  })

  it('ignores a malformed thread id in the address', async () => {
    renderPage('/courriels?fil=pas-un-identifiant')
    expect(await screen.findByRole('list', { name: t(`${I}.list.label`) })).toBeInTheDocument()
    expect(screen.getByText(t(`${I}.thread.select`))).toBeInTheDocument()
    expect(mocks.inbox.getMailThread).not.toHaveBeenCalled()
  })

  it('a purged body says so and points to Gmail', async () => {
    mocks.inbox.getMailThread.mockResolvedValue(
      thread({ unread_count: 0, messages: [message({ body_text: null, body_purged: true, snippet: null })] }),
    )
    renderPage(`/courriels?fil=${T1}`)
    expect(await screen.findByText(t(`${I}.thread.purged`))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${I}.thread.openInGmail`) })).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/?authuser=info%40clinique.test#all/18c0001',
    )
  })

  it('without a connected mailbox, says who connects one', async () => {
    mocks.mailboxes.listMailConnections.mockResolvedValue([{ ...MAILBOX, status: 'disconnected' }])
    renderPage()
    expect(await screen.findByText(t(`${I}.noMailboxTitle`))).toBeInTheDocument()
    expect(mocks.inbox.listMailThreads).not.toHaveBeenCalled()
  })

  it('a list that cannot load offers to try again', async () => {
    const user = userEvent.setup()
    mocks.inbox.listMailThreads.mockRejectedValueOnce(new Error('network'))
    renderPage()
    expect(await screen.findByText(t(`${I}.list.loadError`))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('list', { name: t(`${I}.list.label`) })).toBeInTheDocument()
  })
})

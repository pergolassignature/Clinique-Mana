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
  composer: {
    listDrafts: vi.fn(),
    getDraft: vi.fn(),
    saveDraft: vi.fn(),
    listTemplates: vi.fn(),
    sendMail: vi.fn(),
  },
  links: {
    getMailThreadLink: vi.fn(),
    linkMailThread: vi.fn(),
    unlinkMailThread: vi.fn(),
    searchFiles: vi.fn(),
  },
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
vi.mock('../api/composer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/composer')>()),
  ...mocks.composer,
}))
vi.mock('../components/composer/RichEmailEditor', () => ({
  RichEmailEditor: ({ initialHtml, label }: { initialHtml: string; label: string }) => <textarea aria-label={label} defaultValue={initialHtml} />,
}))
vi.mock('../api/client-links', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client-links')>()),
  ...mocks.links,
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
  mocks.inbox.modifyMailThreads.mockResolvedValue({ changed: 1, failed: [] })
  mocks.composer.listDrafts.mockResolvedValue([])
  mocks.composer.listTemplates.mockResolvedValue([])
  mocks.composer.saveDraft.mockResolvedValue({ id: 'd1', updatedAt: '2026-10-13T15:00:00Z' })
  mocks.links.getMailThreadLink.mockResolvedValue({ status: 'unlinked', source: null, client: null, candidates: [] })
  mocks.links.linkMailThread.mockResolvedValue(undefined)
  mocks.links.unlinkMailThread.mockResolvedValue(undefined)
  mocks.links.searchFiles.mockResolvedValue([])
  mocks.storage.useSignedFileUrl.mockImplementation((id: string | null) => ({
    data: id ? { url: `https://storage.test/${id}` } : undefined,
  }))
  mocks.storage.useSignedFileUrls.mockReturnValue({ urls: new Map(), refetchFor: vi.fn() })
})
afterEach(() => vi.clearAllMocks())

function renderPage(path = '/courriels', { files = true }: { files?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const base = accessForRole('counselor', { modules: ['communications', 'clients'] })
  const access = files ? base : { ...base, modules: ['communications'], permissions: base.permissions.filter((p) => !p.startsWith('clients.')) }
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
    expect(await screen.findByRole('button', { name: t(`${I}.thread.unstar`) })).toBeInTheDocument()
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

  it('on a phone, « Dossier » chooses a view or a label (the unread count in plain words)', async () => {
    const user = userEvent.setup()
    renderPage()
    const folder = await screen.findByRole('combobox', { name: t(`${I}.nav.folder`) })
    expect(within(folder).getByRole('option', { name: t(`${I}.nav.inboxWithUnreadOther`, { count: '2' }) })).toBeInTheDocument()
    await screen.findByRole('option', { name: 'Factures' })
    await user.selectOptions(folder, 'libelle:Label_1')
    await waitFor(() =>
      expect(mocks.inbox.listMailThreads).toHaveBeenLastCalledWith(
        { connectionId: MAILBOX.id, view: 'label', labelId: 'Label_1', search: '' },
        null,
      ),
    )
    await user.selectOptions(folder, 'starred')
    await waitFor(() =>
      expect(mocks.inbox.listMailThreads).toHaveBeenLastCalledWith(
        { connectionId: MAILBOX.id, view: 'starred', labelId: null, search: '' },
        null,
      ),
    )
  })

  it('« Retour aux courriels » closes the thread and gives the focus back to its row', async () => {
    const user = userEvent.setup()
    mocks.inbox.getMailThread.mockResolvedValue(thread({ unread_count: 0, label_ids: ['INBOX'] }))
    renderPage(`/courriels?fil=${T1}`)
    await user.click(await screen.findByRole('button', { name: t(`${I}.thread.back`) }))
    expect(await screen.findByText(t(`${I}.thread.select`))).toBeInTheDocument()
    const list = screen.getByRole('list', { name: t(`${I}.list.label`) })
    await waitFor(() => expect(within(list).getAllByRole('button')[0]).toHaveFocus())
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

describe('InboxPage: the thread → client link (CM2b)', () => {
  const C1 = 'c0000000-0000-0000-0000-000000000001'
  const C2 = 'c0000000-0000-0000-0000-000000000002'
  const L = `${I}.link`

  it('« À rattacher » is a view for whoever sees files, read with `to_link`', async () => {
    const user = userEvent.setup()
    renderPage()
    const nav = await screen.findByRole('navigation', { name: t(`${I}.nav.label`) })
    await user.click(within(nav).getByRole('button', { name: t(`${I}.nav.views.to_link`) }))
    await waitFor(() =>
      expect(mocks.inbox.listMailThreads).toHaveBeenCalledWith({ connectionId: MAILBOX.id, view: 'to_link', labelId: null, search: '' }, null),
    )
  })

  it('without clients.view: no « À rattacher », `?vue=to_link` is the inbox, and no file in the thread', async () => {
    renderPage(`/courriels?vue=to_link&fil=${T1}`, { files: false })
    const nav = await screen.findByRole('navigation', { name: t(`${I}.nav.label`) })
    expect(within(nav).queryByRole('button', { name: t(`${I}.nav.views.to_link`) })).not.toBeInTheDocument()
    expect(mocks.inbox.listMailThreads).toHaveBeenCalledWith({ connectionId: MAILBOX.id, view: 'inbox', labelId: null, search: '' }, null)
    expect(await screen.findByRole('heading', { level: 2, name: 'Demande de rendez-vous' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: t(`${L}.label`) })).not.toBeInTheDocument()
    expect(mocks.links.getMailThreadLink).not.toHaveBeenCalled()
  })

  it('a linked thread shows its file (opening the record) and « Détacher » unlinks it', async () => {
    const user = userEvent.setup()
    mocks.links.getMailThreadLink.mockResolvedValue({
      status: 'linked',
      source: 'auto',
      client: { id: C1, client_number: 42, display_name: 'Alice Exemple' },
      candidates: [],
    })
    renderPage(`/courriels?fil=${T1}`)
    const group = await screen.findByRole('group', { name: t(`${L}.label`) })
    expect(within(group).getByRole('link', { name: 'CLI-000042 · Alice Exemple' })).toHaveAttribute('href', `/clients/${C1}`)
    expect(within(group).getByText(t(`${L}.auto`))).toBeInTheDocument()
    await user.click(within(group).getByRole('button', { name: t(`${L}.unlink`) }))
    await waitFor(() => expect(mocks.links.unlinkMailThread).toHaveBeenCalledWith(T1))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${L}.unlinkedToast`))
  })

  it('to review: each matching file with « Rattacher »', async () => {
    const user = userEvent.setup()
    mocks.links.getMailThreadLink.mockResolvedValue({
      status: 'needs_review',
      source: 'auto',
      client: null,
      candidates: [
        { id: C1, client_number: 42, display_name: 'Alice Exemple' },
        { id: C2, client_number: 43, display_name: 'Bruno Exemple' },
      ],
    })
    renderPage(`/courriels?fil=${T1}`)
    const group = await screen.findByRole('group', { name: t(`${L}.label`) })
    expect(within(group).getByRole('link', { name: 'CLI-000043 · Bruno Exemple' })).toHaveAttribute('href', `/clients/${C2}`)
    await user.click(within(group).getByRole('button', { name: t(`${L}.linkToLabel`, { file: 'CLI-000043 · Bruno Exemple' }) }))
    await waitFor(() => expect(mocks.links.linkMailThread).toHaveBeenCalledWith(T1, C2))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${L}.linkedToast`))
  })

  it('not linked: « Rattacher à un dossier » searches the files (two characters at least) and links the one chosen', async () => {
    const user = userEvent.setup()
    mocks.links.searchFiles.mockResolvedValue([{ id: C1, clientNumber: 42, name: 'Alice Exemple', isArchived: true }])
    renderPage(`/courriels?fil=${T1}`)
    const group = await screen.findByRole('group', { name: t(`${L}.label`) })
    expect(within(group).getByText(t(`${L}.none`))).toBeInTheDocument()
    await user.click(within(group).getByRole('button', { name: t(`${L}.link`) }))
    const input = await screen.findByLabelText(t(`${L}.searchLabel`))
    await user.type(input, 'a')
    expect(screen.getByText(t(`${L}.searchHint`))).toBeInTheDocument()
    expect(mocks.links.searchFiles).not.toHaveBeenCalled()
    await user.type(input, 'li')
    const results = await screen.findByRole('list', { name: t(`${L}.results`) })
    expect(mocks.links.searchFiles).toHaveBeenCalledWith('ali', expect.anything())
    const choice = within(results).getByRole('button', { name: /CLI-000042 · Alice Exemple/ })
    expect(choice).toHaveTextContent(t(`${L}.archived`))
    await user.click(choice)
    await waitFor(() => expect(mocks.links.linkMailThread).toHaveBeenCalledWith(T1, C1))
  })

  it('a refused link says why in French', async () => {
    const user = userEvent.setup()
    mocks.links.getMailThreadLink.mockResolvedValue({
      status: 'needs_review',
      source: 'auto',
      client: null,
      candidates: [{ id: C1, client_number: 42, display_name: 'Alice Exemple' }],
    })
    mocks.links.linkMailThread.mockRejectedValue({ code: 'P0001', message: 'Choisissez un dossier client de la clinique.', hint: 'client_id' })
    renderPage(`/courriels?fil=${T1}`)
    const group = await screen.findByRole('group', { name: t(`${L}.label`) })
    await user.click(within(group).getByRole('button', { name: t(`${L}.linkToLabel`, { file: 'CLI-000042 · Alice Exemple' }) }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Choisissez un dossier client de la clinique.'))
  })
})

describe('InboxPage: the composer (CM3)', () => {
  const K = 'modules.communications.composer'

  it('« Répondre » opens the composer on the thread: the sender, « Re : », the quote', async () => {
    const user = userEvent.setup()
    renderPage(`/courriels?fil=${T1}`)
    await user.click(await screen.findByRole('button', { name: t(`${I}.thread.reply`) }))
    const composer = await screen.findByRole('dialog', { name: /Demande de rendez-vous/ })
    expect(within(composer).getByLabelText(t(`${K}.to`))).toHaveValue('alice@exemple.test')
    expect(within(composer).getByLabelText(t(`${K}.subject`))).toHaveValue(`${t(`${K}.prefixReply`)} Demande de rendez-vous`)
    expect((within(composer).getByLabelText(t(`${K}.body`)) as HTMLTextAreaElement).value).toContain('<blockquote>')
  })

  it('« Nouveau message » opens an empty composer; « Brouillons » lists the drafts and reopens one', async () => {
    const user = userEvent.setup()
    mocks.composer.listDrafts.mockResolvedValue([
      { id: 'd1', connection_id: MAILBOX.id, mode: 'new', thread_id: null, client_id: null, subject: 'Suivi', to_addresses: ['bruno@exemple.test'], attachment_count: 0, updated_at: '2026-10-13T14:00:00Z' },
    ])
    mocks.composer.getDraft.mockResolvedValue({
      id: 'd1', connectionId: MAILBOX.id, mode: 'new', threadId: null, replyToMessageId: null, clientId: null,
      to: ['bruno@exemple.test'], cc: [], bcc: [], subject: 'Suivi', bodyHtml: '<p>Texte</p>', attachments: [], updatedAt: '2026-10-13T14:00:00Z',
    })
    renderPage()
    const nav = await screen.findByRole('navigation', { name: t(`${I}.nav.label`) })
    await user.click(within(nav).getByRole('button', { name: t(`${I}.nav.newMessage`) }))
    expect(await screen.findByRole('dialog', { name: t(`${K}.titleNew`) })).toBeInTheDocument()
    await user.click(within(nav).getByRole('button', { name: new RegExp(t(`${I}.nav.views.drafts`)) }))
    const drafts = await screen.findByRole('list', { name: t(`${I}.drafts.label`) })
    await user.click(within(drafts).getByRole('button', { name: /Suivi/ }))
    const composer = await screen.findByRole('dialog', { name: /Suivi/ })
    expect(within(composer).getByLabelText(t(`${K}.to`))).toHaveValue('bruno@exemple.test')
    expect(mocks.composer.getDraft).toHaveBeenCalledWith('d1')
  })
})

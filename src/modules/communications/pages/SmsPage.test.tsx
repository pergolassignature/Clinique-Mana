import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { notificationKeys } from '@/core/notifications/hooks'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { SmsMessage, SmsThread } from '../api/sms'
import { SmsPage } from './SmsPage'

const mocks = vi.hoisted(() => ({
  api: {
    listSmsThreads: vi.fn(),
    listSmsThread: vi.fn(),
    findSmsMessagePhone: vi.fn(),
    setSmsConsent: vi.fn(),
    sendSms: vi.fn(),
    sendSmsTest: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api/sms', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api/sms')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const S = 'modules.communications.sms'
const PHONE = '+15145551234'
const OTHER = '+14385550000'

const thread = (over: Partial<SmsThread> = {}): SmsThread => ({
  phone: PHONE,
  lastMessageAt: '2027-03-10T15:00:00Z',
  lastDirection: 'in',
  lastStatus: 'received',
  lastBody: 'Bonjour, je voudrais déplacer mon rendez-vous.',
  lastBodyPurged: false,
  lastHasMedia: false,
  messageCount: 2,
  lastInboundAt: '2027-03-10T15:00:00Z',
  consent: 'opted_in',
  ...over,
})

const msg = (over: Partial<SmsMessage>): SmsMessage => ({
  id: 'm1',
  direction: 'in',
  phone: PHONE,
  kind: 'inbound',
  body: 'Bonjour',
  purged: false,
  media: [],
  status: 'received',
  errorCode: null,
  sendAfter: null,
  createdAt: '2027-03-10T14:00:00Z',
  sentAt: '2027-03-10T14:00:00Z',
  ...over,
})

beforeEach(() => {
  mocks.api.listSmsThreads.mockResolvedValue([thread(), thread({ phone: OTHER, consent: null, lastDirection: 'out', lastStatus: 'failed', lastBody: 'Rappel' })])
  mocks.api.listSmsThread.mockResolvedValue({
    messages: [
      msg({}),
      msg({ id: 'm2', direction: 'out', kind: 'reply', body: 'À demain', status: 'failed', errorCode: 'provider_rejected' }),
      msg({ id: 'm3', direction: 'in', body: null, media: [{ name: 'photo.jpg', type: 'image/jpeg' }] }),
    ],
    truncated: false,
  })
  mocks.api.findSmsMessagePhone.mockResolvedValue(PHONE)
})
afterEach(() => vi.clearAllMocks())

function renderPage({ path = '/textos', permissions }: { path?: string; permissions?: string[] } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const access = accessForRole('admin', permissions ? { permissions, modules: ['communications'] } : { modules: ['communications'] })
  render(<QueryClientProvider client={queryClient}>{renderWithContexts(<SmsPage />, { access: { access }, path })}</QueryClientProvider>)
  return queryClient
}

const openThread = async (label = '514 555-1234') => {
  const list = await screen.findByRole('list', { name: t(`${S}.threads.label`) })
  await userEvent.click(within(list).getByRole('button', { name: new RegExp(label) }))
  return screen.findByRole('region', { name: t(`${S}.thread.label`, { phone: label }) })
}

describe('SmsPage', () => {
  it('lists the conversations with the consent in force and a failed last text', async () => {
    renderPage()
    const list = await screen.findByRole('list', { name: t(`${S}.threads.label`) })
    const rows = within(list).getAllByRole('button')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('514 555-1234')
    expect(rows[0]).toHaveTextContent(t(`${S}.consent.opted_in`))
    expect(rows[1]).toHaveTextContent(t(`${S}.consent.none`))
    expect(rows[1]).toHaveTextContent(t(`${S}.status.failed`))
    expect(rows[1]).toHaveTextContent(t(`${S}.threads.you`, { text: 'Rappel' }))
    expect(screen.getByText(t(`${S}.threads.countOther`, { count: '2' }))).toBeInTheDocument()
  })

  it('opens a thread: received on one side, a failed reply with its reason, an attachment not kept', async () => {
    renderPage()
    const region = await openThread()
    expect(await within(region).findByText('À demain')).toBeInTheDocument()
    expect(within(region).getByText(t(`${S}.errorCode.provider_rejected`))).toBeInTheDocument()
    expect(within(region).getByText(t(`${S}.thread.attachment`, { name: 'photo.jpg' }))).toBeInTheDocument()
    expect(mocks.api.listSmsThread).toHaveBeenCalledWith(PHONE)
    expect(within(region).getByRole('button', { name: t(`${S}.consent.withdraw`) })).toBeInTheDocument()
  })

  it('sends a reply through sms-send and empties the box', async () => {
    mocks.api.sendSms.mockResolvedValue({ id: 'm9' })
    renderPage()
    const region = await openThread()
    const box = within(region).getByRole('textbox', { name: t(`${S}.composer.label`) })
    await userEvent.type(box, 'Oui, à demain 10 h.')
    await userEvent.click(within(region).getByRole('button', { name: t(`${S}.composer.send`) }))
    await waitFor(() => expect(mocks.api.sendSms).toHaveBeenCalledWith({ to: PHONE, body: 'Oui, à demain 10 h.' }))
    await waitFor(() => expect(box).toHaveValue(''))
  })

  it("a PBX failure stays above the box with the PBX's reason, the text kept", async () => {
    mocks.api.sendSms.mockRejectedValue(new FunctionCallError('provider_error', 502, 'x', { extra: { sms_message_id: 'm9', code: 'provider_unreachable' } }))
    renderPage()
    const region = await openThread()
    const box = within(region).getByRole('textbox', { name: t(`${S}.composer.label`) })
    await userEvent.type(box, 'Bonjour')
    await userEvent.click(within(region).getByRole('button', { name: t(`${S}.composer.send`) }))
    expect(await within(region).findByRole('alert')).toHaveTextContent(t(`${S}.errorCode.provider_unreachable`))
    expect(box).toHaveValue('Bonjour')
  })

  it('no reply box without a consent: the page says why and offers to record it', async () => {
    renderPage()
    const region = await openThread('438 555-0000')
    expect(within(region).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(region).getByText(t(`${S}.composer.noConsent`))).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: t(`${S}.consent.record`) })).toBeInTheDocument()
  })

  it('« Nouveau numéro » records a consent and opens the thread', async () => {
    mocks.api.setSmsConsent.mockResolvedValue({ phone: '+18195550123', status: 'opted_in' })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t(`${S}.consent.newNumber`) }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox', { name: new RegExp(t(`${S}.consent.phone`)) }), '819 555-0123')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${S}.consent.submit`) }))
    await waitFor(() => expect(mocks.api.setSmsConsent).toHaveBeenCalledWith({ phone: '+18195550123', status: 'opted_in', note: null }))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${S}.consent.saved`))
    expect(await screen.findByRole('region', { name: t(`${S}.thread.label`, { phone: '819 555-0123' }) })).toBeInTheDocument()
  })

  it('a number that cannot be read is refused before any call', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: t(`${S}.consent.newNumber`) }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox', { name: new RegExp(t(`${S}.consent.phone`)) }), '555-0123')
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${S}.consent.submit`) }))
    expect(await within(dialog).findByText(t(`${S}.phone.invalid`))).toBeInTheDocument()
    expect(mocks.api.setSmsConsent).not.toHaveBeenCalled()
  })

  it("a notice's link opens its text's thread; the number never goes in the URL", async () => {
    renderPage({ path: '/textos?message=6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e' })
    expect(await screen.findByRole('region', { name: t(`${S}.thread.label`, { phone: '514 555-1234' }) })).toBeInTheDocument()
    expect(mocks.api.findSmsMessagePhone).toHaveBeenCalledWith('6f1c1b2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e')
  })

  it('follows the bell: a new unread count reloads the threads (no timer of its own)', async () => {
    const queryClient = renderPage()
    queryClient.setQueryData(notificationKeys.count(), { total: 1, important: 0 })
    await screen.findByRole('list', { name: t(`${S}.threads.label`) })
    expect(mocks.api.listSmsThreads).toHaveBeenCalledTimes(1)
    queryClient.setQueryData(notificationKeys.count(), { total: 2, important: 0 })
    await waitFor(() => expect(mocks.api.listSmsThreads).toHaveBeenCalledTimes(2))
  })

  it('an empty clinic: two plain lines', async () => {
    mocks.api.listSmsThreads.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(t(`${S}.threads.emptyTitle`))).toBeInTheDocument()
  })
})

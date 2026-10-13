import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import type { DraftContent } from '../../api/composer'
import { MAILBOX } from '../../test/fixtures'
import { initialContent } from '../../lib/compose'
import { AUTOSAVE_MS, Composer, UNDO_SECONDS } from './Composer'

const mocks = vi.hoisted(() => ({
  api: {
    saveDraft: vi.fn(),
    deleteDraft: vi.fn(),
    listTemplates: vi.fn(),
    saveTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    sendMail: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/composer', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/composer')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
// TipTap needs a real layout engine: a textarea stands in (the editor's own behaviour is TipTap's).
vi.mock('./RichEmailEditor', () => ({
  RichEmailEditor: ({ initialHtml, replaceWith, onChange, label }: { initialHtml: string; replaceWith?: { html: string } | null; onChange: (html: string) => void; label: string }) => (
    <textarea aria-label={label} defaultValue={replaceWith?.html ?? initialHtml} key={replaceWith?.html ?? 'initial'} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const C = 'modules.communications.composer'

/** The countdown, one second at a time (each second is its own timer). */
async function tick(seconds: number) {
  for (let i = 0; i < seconds; i++) await act(() => vi.advanceTimersByTimeAsync(1_000))
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mocks.api.saveDraft.mockResolvedValue({ id: 'd1', updatedAt: '2026-10-13T15:00:00Z' })
  mocks.api.listTemplates.mockResolvedValue([
    { kind: 'clinic', id: 'communications.acknowledgement', name: 'Accusé de réception', subject: 'Votre message', body: 'Bonjour {{person.first_name}},\n\nMerci.', format: 'text' },
  ])
  mocks.api.sendMail.mockResolvedValue({ status: 'sent', thread_id: 't9', gmail_message_id: 'g9' })
  mocks.api.deleteDraft.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

function renderComposer(initial: DraftContent = initialContent({ connectionId: MAILBOX.id, mode: 'new' }), draftId: string | null = null) {
  const onClose = vi.fn()
  const onSent = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Composer draftId={draftId} initial={initial} mailboxes={[MAILBOX]} personKnown={false} onClose={onClose} onSent={onSent} />,
      )}
    </QueryClientProvider>,
  )
  return { onClose, onSent, user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }) }
}

describe('Composer', () => {
  it('saves the draft as one types (the database, never the browser)', async () => {
    const { user } = renderComposer()
    await user.type(screen.getByLabelText(t(`${C}.to`)), 'Alice@Exemple.test')
    await user.type(screen.getByLabelText(t(`${C}.subject`)), 'Bonjour')
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 100))
    await waitFor(() => expect(mocks.api.saveDraft).toHaveBeenCalled())
    const [id, content] = mocks.api.saveDraft.mock.calls.at(-1)!
    expect(id).toBeNull()
    expect(content).toMatchObject({ to: ['alice@exemple.test'], subject: 'Bonjour', mode: 'new' })
    expect(await screen.findByText(new RegExp(t(`${C}.savedAt`, { time: '' }).trim().slice(0, 10)))).toBeInTheDocument()
  })

  it('says what is missing instead of counting down', async () => {
    const { user } = renderComposer()
    await user.click(screen.getByRole('button', { name: t(`${C}.send`) }))
    expect(screen.getByRole('alert')).toHaveTextContent(t(`${C}.problems.noRecipient`))
    await user.type(screen.getByLabelText(t(`${C}.to`)), 'pas-une-adresse')
    await user.click(screen.getByRole('button', { name: t(`${C}.send`) }))
    expect(screen.getAllByText(t(`${C}.problems.badAddress`, { address: 'pas-une-adresse' })).length).toBeGreaterThan(0)
    expect(mocks.api.sendMail).not.toHaveBeenCalled()
  })

  it('« Envoyer »: five seconds to « Annuler l’envoi », then one send with its key and the draft', async () => {
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), to: ['alice@exemple.test'], subject: 'Bonjour', bodyHtml: '<p>Texte</p>' }
    const { user, onSent } = renderComposer(initial, 'd1')
    await user.click(screen.getByRole('button', { name: t(`${C}.send`) }))
    expect(await screen.findByText(t(`${C}.sendingIn`, { seconds: String(UNDO_SECONDS) }))).toBeInTheDocument()
    // « Annuler l'envoi » stops it.
    await user.click(screen.getByRole('button', { name: t(`${C}.undo`) }))
    await tick(UNDO_SECONDS + 1)
    expect(mocks.api.sendMail).not.toHaveBeenCalled()
    // Again, left to run.
    await user.click(screen.getByRole('button', { name: t(`${C}.send`) }))
    await tick(UNDO_SECONDS + 1)
    await waitFor(() => expect(mocks.api.sendMail).toHaveBeenCalledTimes(1))
    const [key, draftId, content] = mocks.api.sendMail.mock.calls[0]!
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(draftId).toBe('d1')
    expect(content).toMatchObject({ to: ['alice@exemple.test'], subject: 'Bonjour' })
    await waitFor(() => expect(onSent).toHaveBeenCalledWith('t9'))
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${C}.sent`))
  })

  it('a send Gmail did not confirm says to look in « Envoyés »; the composer stays open', async () => {
    mocks.api.sendMail.mockRejectedValue(new FunctionCallError('provider_error', 502, 'Google refused the send'))
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), to: ['alice@exemple.test'], subject: 'Bonjour', bodyHtml: '<p>Texte</p>' }
    const { user, onSent } = renderComposer(initial, 'd1')
    await user.click(screen.getByRole('button', { name: t(`${C}.send`) }))
    await tick(UNDO_SECONDS + 1)
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${C}.errors.notConfirmed`))
    expect(onSent).not.toHaveBeenCalled()
  })

  it('a clinic template fills an empty message and its subject', async () => {
    const { user } = renderComposer()
    await user.click(screen.getByRole('button', { name: t(`${C}.templates`) }))
    await user.click(await screen.findByRole('menuitem', { name: 'Accusé de réception' }))
    expect(screen.getByLabelText(t(`${C}.subject`))).toHaveValue('Votre message')
    expect(screen.getByLabelText(t(`${C}.body`))).toHaveValue('<p>Bonjour {{person.first_name}},</p><p>Merci.</p>')
  })

  it('« Supprimer le brouillon » asks, then deletes it', async () => {
    const { user, onClose } = renderComposer(initialContent({ connectionId: MAILBOX.id, mode: 'new' }), 'd1')
    await user.click(screen.getByRole('button', { name: t(`${C}.discard`) }))
    await user.click(await screen.findByRole('button', { name: t(`${C}.discardAction`) }))
    await waitFor(() => expect(mocks.api.deleteDraft).toHaveBeenCalledWith('d1', expect.anything()))
    expect(onClose).toHaveBeenCalled()
  })
})

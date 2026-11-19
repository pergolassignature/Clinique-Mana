import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { composerText } from '../../lib/email-ui'
import { FunctionCallError } from '@/core/supabase/functions'
import { renderWithContexts } from '@/test/contexts'
import type { DraftContent } from '../../api/composer'
import { MAILBOX } from '../../test/fixtures'
import { initialContent } from '../../lib/compose'
import { ComposerContext, type ComposeRequest } from '../../hooks/use-composer-launcher'
import { AUTOSAVE_MS, Composer } from './Composer'

const mocks = vi.hoisted(() => ({
  api: {
    saveDraft: vi.fn(),
    deleteDraft: vi.fn(),
    listTemplates: vi.fn(),
    saveTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    sendMail: vi.fn(),
  },
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  open: vi.fn(),
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

/** The engine's five seconds of « Annuler » (email-ui 0.7.0). */
const UNDO_MS = 5_000

/** The last notice the engine showed with a button (the countdown, a deletion): its button. */
function noticeAction(): { label: string; onClick: () => void } {
  const calls = [...mocks.toast.mock.calls, ...mocks.toast.error.mock.calls].filter(([, options]) => options?.action)
  return calls.at(-1)![1].action
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
  // The page's launcher: « Annuler » and « Rouvrir » reopen the composer through it.
  const launcher = { open: (request: ComposeRequest) => mocks.open(request), isOpen: true }
  const tree = (value: DraftContent) => (
    <QueryClientProvider client={queryClient}>
      <ComposerContext.Provider value={launcher}>
        {renderWithContexts(
          <Composer draftId={draftId} initial={value} mailboxes={[MAILBOX]} personKnown={false} onClose={onClose} onSent={onSent} />,
        )}
      </ComposerContext.Provider>
    </QueryClientProvider>
  )
  const view = render(tree(initial))
  return {
    onClose,
    onSent,
    view,
    rerender: (value: DraftContent) => view.rerender(tree(value)),
    user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }),
  }
}

describe('Composer', () => {
  it('saves the draft as one types (the database, never the browser)', async () => {
    const { user } = renderComposer()
    // Entrée makes the address a chip (CM-25), as Tab, a comma or leaving the field do.
    await user.type(screen.getByLabelText(t(`${C}.to`)), 'Alice@Exemple.test{Enter}')
    expect(screen.getByText('alice@exemple.test')).toBeInTheDocument()
    await user.type(screen.getByLabelText(composerText('mailCompose.subjectPlaceholder')), 'Bonjour')
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 100))
    await waitFor(() => expect(mocks.api.saveDraft).toHaveBeenCalled())
    const [id, content] = mocks.api.saveDraft.mock.calls.at(-1)!
    expect(id).toBeNull()
    expect(content).toMatchObject({ to: ['alice@exemple.test'], subject: 'Bonjour', mode: 'new' })
    expect(await screen.findByText(new RegExp(t(`${C}.savedAt`, { time: '' }).trim().slice(0, 10)))).toBeInTheDocument()
  })

  it('a pasted list of addresses becomes one chip each, and the draft keeps them all (CM-25)', async () => {
    const { user } = renderComposer()
    await user.click(screen.getByLabelText(t(`${C}.to`)))
    await user.paste('Alice <alice@exemple.test>, bruno@exemple.test; carole@exemple.test')
    await user.keyboard('{Enter}')
    for (const address of ['alice@exemple.test', 'bruno@exemple.test', 'carole@exemple.test']) expect(screen.getByText(address)).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 100))
    await waitFor(() => expect(mocks.api.saveDraft).toHaveBeenCalled())
    expect(mocks.api.saveDraft.mock.calls.at(-1)![1]).toMatchObject({ to: ['alice@exemple.test', 'bruno@exemple.test', 'carole@exemple.test'] })
  })

  it('saves nothing on opening, nor when the page renders again: only a real change', async () => {
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), to: ['alice@exemple.test'], subject: 'Bonjour' }
    const { rerender, view } = renderComposer(initial, 'd1')
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 3))
    // The parent builds the same content again (a new object): still nothing to save.
    rerender({ ...initial, to: [...initial.to] })
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_MS * 3))
    view.unmount()
    expect(mocks.api.saveDraft).not.toHaveBeenCalled()
  })

  it('a typed text that is not a real address stays in « À », and « Envoyer » says so (CM-25)', async () => {
    const { user, onClose } = renderComposer()
    await user.type(screen.getByLabelText(t(`${C}.to`)), 'marc@clinique{Enter}')
    expect(screen.getByLabelText(t(`${C}.to`))).toHaveValue('marc@clinique')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${C}.problems.badAddress`, { address: 'marc@clinique' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(mocks.api.sendMail).not.toHaveBeenCalled()
  })

  it('says what is missing, stays open and sends nothing', async () => {
    const { user, onClose } = renderComposer()
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${C}.problems.noRecipient`))
    await user.type(screen.getByLabelText(t(`${C}.to`)), 'pas-une-adresse')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    await waitFor(() => expect(screen.getAllByText(t(`${C}.problems.badAddress`, { address: 'pas-une-adresse' })).length).toBeGreaterThan(0))
    expect(onClose).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS * 2))
    expect(mocks.api.sendMail).not.toHaveBeenCalled()
  })

  // CM-27: PS Hub's compose engine.
  it('« Envoyer » closes the composer; the message leaves five seconds later, with its key and the draft', async () => {
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), to: ['alice@exemple.test'], subject: 'Bonjour', bodyHtml: '<p>Texte</p>' }
    const { user, onClose, onSent } = renderComposer(initial, 'd1')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    // Saved first, so « Annuler » finds the draft.
    expect(mocks.api.saveDraft).toHaveBeenCalledWith('d1', expect.objectContaining({ subject: 'Bonjour' }))
    expect(mocks.toast).toHaveBeenCalledWith(
      composerText('mailCompose.sendPendingCountdown', { seconds: 5 }),
      expect.objectContaining({ action: expect.objectContaining({ label: composerText('mailCompose.sendUndo') }) }),
    )
    expect(mocks.api.sendMail).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS + 100))
    await waitFor(() => expect(mocks.api.sendMail).toHaveBeenCalledTimes(1))
    const [key, draftId, content] = mocks.api.sendMail.mock.calls[0]!
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(draftId).toBe('d1')
    expect(content).toMatchObject({ to: ['alice@exemple.test'], subject: 'Bonjour' })
    await waitFor(() => expect(onSent).toHaveBeenCalledWith('t9'))
    expect(mocks.toast.success).toHaveBeenCalledWith(composerText('mailCompose.sendSuccess'), expect.anything())
  })

  it('« Annuler » in the five seconds reopens the composer with what it held, and nothing leaves', async () => {
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), to: ['alice@exemple.test'], subject: 'Bonjour', bodyHtml: '<p>Texte</p>' }
    const { user, onClose } = renderComposer(initial, 'd1')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    act(() => noticeAction().onClick())
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'draft', draftId: 'd1', content: expect.objectContaining({ subject: 'Bonjour', to: ['alice@exemple.test'] }) }),
    )
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS * 2))
    expect(mocks.api.sendMail).not.toHaveBeenCalled()
  })

  it('a send Gmail did not confirm: « L’envoi a échoué » says to look in « Envoyés », with « Rouvrir »', async () => {
    mocks.api.sendMail.mockRejectedValue(new FunctionCallError('provider_error', 502, 'Google refused the send'))
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), to: ['alice@exemple.test'], subject: 'Bonjour', bodyHtml: '<p>Texte</p>' }
    const { user, onSent } = renderComposer(initial, 'd1')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS + 100))
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        composerText('mailCompose.sendFailedTitle'),
        expect.objectContaining({ description: t(`${C}.errors.notConfirmed`), action: expect.objectContaining({ label: composerText('mailCompose.sendReopen') }) }),
      ),
    )
    expect(onSent).not.toHaveBeenCalled()
    act(() => noticeAction().onClick())
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'draft', draftId: 'd1' }))
  })

  it('a send Gmail refused says so (not « look in Envoyés »)', async () => {
    mocks.api.sendMail.mockRejectedValue(new FunctionCallError('provider_error', 502, 'x', { outcome: 'refused' }))
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), to: ['alice@exemple.test'], subject: 'Bonjour', bodyHtml: '<p>Texte</p>' }
    const { user } = renderComposer(initial, 'd1')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS + 100))
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ description: t(`${C}.errors.refused`) })),
    )
  })

  it('the same message sent again from the reopened composer keeps its key (the server looks before sending)', async () => {
    mocks.api.sendMail.mockRejectedValueOnce(new FunctionCallError('provider_error', 502, 'x', { outcome: 'unknown' }))
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), to: ['alice@exemple.test'], subject: 'Même clé', bodyHtml: '<p>Texte</p>' }
    const first = renderComposer(initial, 'd1')
    await first.user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS + 100))
    await waitFor(() => expect(mocks.api.sendMail).toHaveBeenCalledTimes(1))
    first.view.unmount()
    // « Rouvrir »: a new composer on the same draft and content.
    const second = renderComposer(initial, 'd1')
    await second.user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS + 100))
    await waitFor(() => expect(second.onSent).toHaveBeenCalledWith('t9'))
    const [firstCall, secondCall] = mocks.api.sendMail.mock.calls
    expect(secondCall![0]).toBe(firstCall![0])
  })

  it('the X closes at once and saves behind it, then « Brouillon enregistré »', async () => {
    const { user, onClose } = renderComposer(initialContent({ connectionId: MAILBOX.id, mode: 'new' }), 'd1')
    await user.type(screen.getByLabelText(composerText('mailCompose.subjectPlaceholder')), 'Bonjour')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.close') }))
    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(mocks.api.saveDraft).toHaveBeenCalledWith('d1', expect.objectContaining({ subject: 'Bonjour' })))
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(composerText('mailCompose.draftSaved'), expect.anything()))
  })

  // CM-26: PS Hub's template picker over MANA's templates.
  it('a clinic template fills an empty message and its subject', async () => {
    const { user } = renderComposer()
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.templates.choose') }))
    await user.click(await screen.findByText('Accusé de réception'))
    expect(screen.getByLabelText(composerText('mailCompose.subjectPlaceholder'))).toHaveValue('Votre message')
    expect(screen.getByLabelText(t(`${C}.body`))).toHaveValue('<p>Bonjour {{person.first_name}},</p><p>Merci.</p>')
  })

  it('a message saved as a template needs no subject (a reply keeps its own)', async () => {
    mocks.api.saveTemplate.mockResolvedValue('tpl-9')
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), bodyHtml: '<p>Merci pour votre message.</p>' }
    const { user } = renderComposer(initial, 'd1')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.templates.choose') }))
    await user.click(await screen.findByRole('button', { name: composerText('mailCompose.templates.create') }))
    await user.type(await screen.findByPlaceholderText(composerText('mailCompose.templates.namePlaceholder')), 'Remerciement')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.templates.save') }))
    await waitFor(() => expect(mocks.api.saveTemplate).toHaveBeenCalledWith(null, 'Remerciement', '', '<p>Merci pour votre message.</p>'))
  })

  it('deleting one of my templates asks first', async () => {
    mocks.api.listTemplates.mockResolvedValue([
      { kind: 'personal', id: 'tpl-1', name: 'Mon suivi', subject: 'Suivi', body: '<p>Merci.</p>', format: 'html' },
    ])
    mocks.api.deleteTemplate.mockResolvedValue(undefined)
    const { user } = renderComposer()
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.templates.choose') }))
    await user.click(await screen.findByRole('button', { name: composerText('mailCompose.templates.deleteOne') }))
    expect(mocks.api.deleteTemplate).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: t(`${C}.deleteTemplateAction`) }))
    await waitFor(() => expect(mocks.api.deleteTemplate).toHaveBeenCalledWith('tpl-1', expect.anything()))
  })

  it('« Supprimer le brouillon » closes it, says « Brouillon supprimé » with « Annuler », and deletes it five seconds later', async () => {
    const { user, onClose } = renderComposer(initialContent({ connectionId: MAILBOX.id, mode: 'new' }), 'd1')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.discardDraft') }))
    expect(onClose).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith(composerText('mailCompose.draftDeleted'), expect.objectContaining({ action: expect.anything() }))
    expect(mocks.api.deleteDraft).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS + 100))
    await waitFor(() => expect(mocks.api.deleteDraft).toHaveBeenCalledWith('d1', expect.anything()))
  })

  it('« Annuler » after « Supprimer le brouillon » reopens the draft and deletes nothing', async () => {
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), subject: 'Gardé' }
    const { user } = renderComposer(initial, 'd1')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.discardDraft') }))
    act(() => noticeAction().onClick())
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ kind: 'draft', draftId: 'd1', content: expect.objectContaining({ subject: 'Gardé' }) }))
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS * 2))
    expect(mocks.api.deleteDraft).not.toHaveBeenCalled()
  })

  // CM-23: PS Hub's window around MANA's composer.
  it('docks in PS Hub\'s window: Échap minimizes it, never closes it, and « Agrandir » brings it back', async () => {
    const { user, onClose } = renderComposer()
    const composer = screen.getByRole('dialog', { name: t(`${C}.titleNew`) })
    expect(composer).not.toHaveAttribute('aria-modal')
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.expand') }))
    expect(screen.getByRole('dialog', { name: t(`${C}.titleNew`) })).toBeInTheDocument()
    expect(screen.getByLabelText(t(`${C}.to`))).toHaveFocus()
  })

  it('« Plein écran » and back keep what was typed', async () => {
    const { user } = renderComposer()
    await user.type(screen.getByLabelText(composerText('mailCompose.subjectPlaceholder')), 'Bonjour')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.fullscreen') }))
    expect(screen.getByRole('dialog', { name: 'Bonjour' })).toHaveAttribute('aria-modal', 'true')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.exitFullscreen') }))
    expect(screen.getByLabelText(composerText('mailCompose.subjectPlaceholder'))).toHaveValue('Bonjour')
  })

  it('« Cc » opens its row, focused; « Cci » stays offered', async () => {
    const { user } = renderComposer()
    expect(screen.queryByLabelText(t(`${C}.cc`))).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.addCopy') }))
    expect(screen.getByLabelText(t(`${C}.cc`))).toHaveFocus()
    expect(screen.getByRole('button', { name: composerText('mailCompose.addBlindCopy') })).toBeInTheDocument()
  })

  it('the paperclip opens « Joindre un fichier »\'s picker (files go through FileDropzone)', async () => {
    const { user } = renderComposer()
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.attachFile') }))
    const input = pick.mock.contexts.at(-1) as HTMLInputElement
    expect(input.type).toBe('file')
    expect(input.accept).toContain('application/pdf')
    pick.mockRestore()
  })

  it('its files are PS Hub’s chips: a list « Pièces jointes », and « Retirer » takes one out of the draft', async () => {
    const initial = {
      ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }),
      attachments: [
        { id: 'f1', name: 'Plan.pdf', mime_type: 'application/pdf', size_bytes: 20 * 1024 },
        { id: 'f2', name: 'Photo.jpg', mime_type: 'image/jpeg', size_bytes: 1_468_006 },
      ],
    }
    const { user } = renderComposer(initial, 'd1')
    const list = screen.getByRole('list', { name: composerText('mailCompose.attachmentList') })
    const [plan, photo] = within(list).getAllByRole('listitem')
    expect(plan).toHaveTextContent('Plan.pdf')
    expect(plan).toHaveTextContent(t(`${C}.sizeKb`, { size: '20' }))
    expect(photo).toHaveTextContent(t(`${C}.sizeMb`, { size: '1,4' }))
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.attachmentRemove', { name: 'Plan.pdf' }) }))
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_MS + 100))
    await waitFor(() => expect(mocks.api.saveDraft).toHaveBeenCalled())
    expect(mocks.api.saveDraft.mock.calls.at(-1)![1]).toMatchObject({ attachments: [{ id: 'f2' }] })
  })
})

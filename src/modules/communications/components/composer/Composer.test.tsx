import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { composerText } from '../../lib/email-ui'
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
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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
  const tree = (value: DraftContent) => (
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(
        <Composer draftId={draftId} initial={value} mailboxes={[MAILBOX]} personKnown={false} onClose={onClose} onSent={onSent} />,
      )}
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
    const { user } = renderComposer()
    await user.type(screen.getByLabelText(t(`${C}.to`)), 'marc@clinique{Enter}')
    expect(screen.getByLabelText(t(`${C}.to`))).toHaveValue('marc@clinique')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    expect(screen.getByRole('alert')).toHaveTextContent(t(`${C}.problems.badAddress`, { address: 'marc@clinique' }))
    expect(mocks.api.sendMail).not.toHaveBeenCalled()
  })

  it('says what is missing instead of counting down', async () => {
    const { user } = renderComposer()
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    expect(screen.getByRole('alert')).toHaveTextContent(t(`${C}.problems.noRecipient`))
    await user.type(screen.getByLabelText(t(`${C}.to`)), 'pas-une-adresse')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    expect(screen.getAllByText(t(`${C}.problems.badAddress`, { address: 'pas-une-adresse' })).length).toBeGreaterThan(0)
    expect(mocks.api.sendMail).not.toHaveBeenCalled()
  })

  it('« Envoyer »: five seconds to « Annuler l’envoi », then one send with its key and the draft', async () => {
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), to: ['alice@exemple.test'], subject: 'Bonjour', bodyHtml: '<p>Texte</p>' }
    const { user, onSent } = renderComposer(initial, 'd1')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    expect(await screen.findByText(t(`${C}.sendingIn`, { seconds: String(UNDO_SECONDS) }))).toBeInTheDocument()
    // « Annuler l'envoi » stops it.
    await user.click(screen.getByRole('button', { name: t(`${C}.undo`) }))
    await tick(UNDO_SECONDS + 1)
    expect(mocks.api.sendMail).not.toHaveBeenCalled()
    // Again, left to run.
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
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
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    await tick(UNDO_SECONDS + 1)
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${C}.errors.notConfirmed`))
    expect(onSent).not.toHaveBeenCalled()
  })

  it('« Envoyer » again after no answer keeps the same key (the server looks before sending)', async () => {
    mocks.api.sendMail.mockRejectedValueOnce(new FunctionCallError('provider_error', 502, 'x', { outcome: 'unknown' }))
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), to: ['alice@exemple.test'], subject: 'Bonjour', bodyHtml: '<p>Texte</p>' }
    const { user, onSent } = renderComposer(initial, 'd1')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    await tick(UNDO_SECONDS + 1)
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${C}.errors.notConfirmed`))
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    await tick(UNDO_SECONDS + 1)
    await waitFor(() => expect(onSent).toHaveBeenCalledWith('t9'))
    const [first, second] = mocks.api.sendMail.mock.calls
    expect(second![0]).toBe(first![0])
  })

  it('a send Gmail refused says so (not « look in Envoyés »)', async () => {
    mocks.api.sendMail.mockRejectedValue(new FunctionCallError('provider_error', 502, 'x', { outcome: 'refused' }))
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), to: ['alice@exemple.test'], subject: 'Bonjour', bodyHtml: '<p>Texte</p>' }
    const { user } = renderComposer(initial, 'd1')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    await tick(UNDO_SECONDS + 1)
    expect(await screen.findByRole('alert')).toHaveTextContent(t(`${C}.errors.refused`))
  })

  it('closed during the five seconds: nothing leaves, and the person is told', async () => {
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), to: ['alice@exemple.test'], subject: 'Bonjour', bodyHtml: '<p>Texte</p>' }
    const { user, view } = renderComposer(initial, 'd1')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    view.unmount()
    await act(() => vi.advanceTimersByTimeAsync((UNDO_SECONDS + 1) * 1_000))
    expect(mocks.api.sendMail).not.toHaveBeenCalled()
    expect(mocks.toast.info).toHaveBeenCalledWith(t(`${C}.cancelledByClose`))
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

  it('« Supprimer le brouillon » asks, then deletes it', async () => {
    const { user, onClose } = renderComposer(initialContent({ connectionId: MAILBOX.id, mode: 'new' }), 'd1')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.discardDraft') }))
    await user.click(await screen.findByRole('button', { name: t(`${C}.discardAction`) }))
    await waitFor(() => expect(mocks.api.deleteDraft).toHaveBeenCalledWith('d1', expect.anything()))
    expect(onClose).toHaveBeenCalled()
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

  it('the close is greyed out while the send counts down, and the X keeps the draft otherwise', async () => {
    const initial = { ...initialContent({ connectionId: MAILBOX.id, mode: 'new' }), to: ['alice@exemple.test'], subject: 'Bonjour', bodyHtml: '<p>Texte</p>' }
    const { user, onClose } = renderComposer(initial, 'd1')
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.sendAction') }))
    expect(screen.getByRole('button', { name: composerText('mailCompose.close') })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: t(`${C}.undo`) }))
    await user.click(screen.getByRole('button', { name: composerText('mailCompose.close') }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
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
})

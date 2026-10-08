import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { EmailTemplate } from '@/core/email/api'
import { emailKeys, emailPreviewKeys } from '@/core/email/hooks'
import { renderWithContexts } from '@/test/contexts'
import { TemplateEditorSheet } from './TemplateEditorSheet'

const mocks = vi.hoisted(() => ({
  api: {
    previewEmail: vi.fn(),
    sendTestEmail: vi.fn(),
    saveEmailTemplate: vi.fn(),
    resetEmailTemplate: vi.fn(),
    listEmailTemplates: vi.fn(),
    EmailFunctionError: class extends Error {},
  },
  toast: { success: vi.fn(), error: vi.fn() },
  sentry: { captureException: vi.fn() },
}))
vi.mock('@/core/email/api', () => mocks.api)
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => mocks.sentry)

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

const TEMPLATE: EmailTemplate = {
  key: 'core.staff_invite',
  module_key: 'core',
  label: "Invitation d'un membre du personnel",
  description: 'Envoyé quand un administrateur invite une personne.',
  is_custom: true,
  version: 2,
  updated_at: '2026-10-08T12:00:00Z',
  updated_by_name: 'Julie Roy',
  subject: 'Votre accès à {{clinic.name}}',
  body: 'Bonjour {{invitee.display_name}},\n\nBienvenue.',
  button_label: 'Créer mon accès',
  variables: [
    { path: 'invitee.display_name', label: 'Nom de la personne invitée', sample: 'Marie Tremblay', required: true, kind: 'text' },
    { path: 'clinic.name', label: 'Nom de la clinique', sample: 'Clinique MANA', required: true, kind: 'text' },
  ],
}

const PREVIEW = { subject: 'Votre accès à Clinique MANA', html: '<p>Bonjour Marie Tremblay,</p>', text: 'Bonjour Marie Tremblay,' }

function renderSheet({ template = TEMPLATE, readOnly = false, onClose = vi.fn() } = {}) {
  mocks.api.previewEmail.mockResolvedValue(PREVIEW)
  mocks.api.listEmailTemplates.mockResolvedValue([template])
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      {renderWithContexts(<TemplateEditorSheet template={template} readOnly={readOnly} onClose={onClose} />)}
    </QueryClientProvider>,
  )
  return { ...view, onClose, queryClient }
}

const subject = () => screen.getByLabelText(new RegExp(`^${t('settings.email.editor.subject')}`))
const body = () => screen.getByLabelText(new RegExp(`^${t('settings.email.editor.body')}`)) as HTMLTextAreaElement
const frame = () => document.querySelector('iframe')

describe('TemplateEditorSheet — preview', () => {
  it('renders the stored text at once, in a sandboxed iframe with no script allowed', async () => {
    renderSheet()
    await waitFor(() => expect(frame()).not.toBeNull())
    expect(mocks.api.previewEmail).toHaveBeenCalledExactlyOnceWith(
      TEMPLATE.key,
      { subject: TEMPLATE.subject, body: TEMPLATE.body, button_label: TEMPLATE.button_label },
      expect.any(AbortSignal),
    )
    const iframe = frame()!
    expect(iframe).toHaveAttribute('sandbox', '')
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts')
    // Links do nothing in the frame: they target a new window, which the sandbox refuses.
    expect(iframe).toHaveAttribute('srcdoc', `<base target="_blank">${PREVIEW.html}`)
    expect(screen.getByText(t('settings.email.preview.linksDisabled'))).toBeInTheDocument()
    expect(iframe).toHaveAttribute('title', t('settings.email.preview.frameTitle'))
    expect(iframe).toHaveAttribute('width', '600')
    expect(screen.getByText(PREVIEW.subject)).toBeInTheDocument()
  })

  it('switches between the desktop and phone widths', async () => {
    const user = userEvent.setup()
    renderSheet()
    await waitFor(() => expect(frame()).not.toBeNull())
    const phone = screen.getByRole('button', { name: t('settings.email.preview.phone') })
    expect(phone).toHaveAttribute('aria-pressed', 'false')
    await user.click(phone)
    expect(phone).toHaveAttribute('aria-pressed', 'true')
    expect(frame()).toHaveAttribute('width', '375')
  })

  it('asks for one preview once typing pauses, not one per key', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderSheet()
    await waitFor(() => expect(mocks.api.previewEmail).toHaveBeenCalledTimes(1))
    await user.type(subject(), ' maintenant')
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(mocks.api.previewEmail).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(150))
    await waitFor(() => expect(mocks.api.previewEmail).toHaveBeenCalledTimes(2))
    expect(mocks.api.previewEmail).toHaveBeenLastCalledWith(
      TEMPLATE.key,
      expect.objectContaining({ subject: 'Votre accès à {{clinic.name}} maintenant' }),
      expect.any(AbortSignal),
    )
  })

  it('pauses the preview while the draft has an error, and says why', async () => {
    const user = userEvent.setup()
    renderSheet()
    await waitFor(() => expect(frame()).not.toBeNull())
    await user.type(subject(), ' {{{{client.diagnosis}}')
    // Testing Library reads non-breaking spaces as spaces.
    const paused = t('settings.email.preview.paused', { reason: 'Variable inconnue : {{client.diagnosis}}' }).replace(/\u00a0/g, ' ')
    expect(await screen.findByText(paused)).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 450))
    expect(mocks.api.previewEmail).toHaveBeenCalledTimes(1)
  })

  it('announces why the preview pauses, but not each « Mise à jour de l’aperçu… »', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderSheet()
    await waitFor(() => expect(frame()).not.toBeNull())
    mocks.api.previewEmail.mockReturnValue(new Promise(() => {}))
    await user.type(subject(), '!')
    await act(() => vi.advanceTimersByTimeAsync(450))
    const updating = await screen.findByText(t('settings.email.preview.updating'), { exact: false })
    expect(updating.closest('[aria-live]')).toBeNull()
    await user.clear(subject())
    const live = document.querySelector('[aria-live="polite"]')
    await waitFor(() => expect(live).toHaveTextContent(t('settings.email.validation.subjectRequired')))
    expect(live).not.toHaveTextContent(t('settings.email.preview.updating'))
  })

  it('shows a refusal of the function in French', async () => {
    const error = Object.assign(new mocks.api.EmailFunctionError('Not configured'), { code: 'module_disabled', status: 403 })
    renderSheet()
    mocks.api.previewEmail.mockReset()
    mocks.api.previewEmail.mockRejectedValue(error)
    // The first call already went out with the default mock; the refusal is checked on the next draft.
    const user = userEvent.setup()
    await user.type(subject(), '!')
    expect(await screen.findByText(t('settings.email.errors.module_disabled'), {}, { timeout: 2000 })).toBeInTheDocument()
  })
})

describe('TemplateEditorSheet — editing', () => {
  it('inserts a variable at the cursor of the last field used', async () => {
    const user = userEvent.setup()
    renderSheet()
    const field = body()
    await user.click(field)
    field.setSelectionRange(8, 8)
    await user.click(screen.getByRole('button', { name: t('settings.email.editor.insert', { label: 'Nom de la clinique' }) }))
    expect(field.value).toBe('Bonjour {{clinic.name}}{{invitee.display_name}},\n\nBienvenue.')
    expect(field).toHaveFocus()
    expect(field.selectionStart).toBe(8 + '{{clinic.name}}'.length)
  })

  it('keeps the button link out of reach: only its label can be changed', () => {
    renderSheet()
    expect(screen.getByLabelText(new RegExp(`^${t('settings.email.editor.button')}`))).toHaveValue('Créer mon accès')
    expect(screen.getByText(t('settings.email.editor.buttonHelp'))).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /lien|url/i })).not.toBeInTheDocument()
  })

  it('saves the trimmed draft once, then confirms', async () => {
    const user = userEvent.setup()
    mocks.api.saveEmailTemplate.mockResolvedValue(undefined)
    renderSheet()
    await user.type(subject(), '  ')
    await user.clear(screen.getByLabelText(new RegExp(`^${t('settings.email.editor.button')}`)))
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.email.editor.saved')))
    expect(mocks.api.saveEmailTemplate).toHaveBeenCalledExactlyOnceWith(TEMPLATE.key, {
      subject: TEMPLATE.subject,
      body: TEMPLATE.body,
      button_label: null,
    })
  })

  it('checks the placeholders before saving, with the server’s words', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.type(body(), ' {{{{ client.diagnosis }}')
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    expect(await screen.findByText('Variable inconnue : {{client.diagnosis}}', { selector: 'p.text-destructive' })).toBeInTheDocument()
    expect(mocks.api.saveEmailTemplate).not.toHaveBeenCalled()
  })

  it('shows the P0001 text of a refused save under the form', async () => {
    const user = userEvent.setup()
    const message = 'Accolades non fermées dans le texte.'
    mocks.api.saveEmailTemplate.mockRejectedValue({ code: 'P0001', message })
    renderSheet()
    await user.type(body(), ' !')
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(mocks.sentry.captureException).not.toHaveBeenCalled()
  })

  it('asks before restoring the default text, then restores it', async () => {
    const user = userEvent.setup()
    mocks.api.resetEmailTemplate.mockResolvedValue(undefined)
    renderSheet()
    await user.click(screen.getByRole('button', { name: t('settings.email.editor.reset') }))
    const dialog = await screen.findByRole('alertdialog')
    expect(mocks.api.resetEmailTemplate).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: t('settings.email.editor.resetConfirm') }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.email.editor.resetDone')))
    expect(mocks.api.resetEmailTemplate).toHaveBeenCalledExactlyOnceWith(TEMPLATE.key)
  })

  it('offers no reset for a template still on its default text', () => {
    renderSheet({ template: { ...TEMPLATE, is_custom: false, version: 0, updated_at: null, updated_by_name: null } })
    expect(screen.queryByRole('button', { name: t('settings.email.editor.reset') })).not.toBeInTheDocument()
  })

  it('sends a test of the draft to the caller and says where', async () => {
    const user = userEvent.setup()
    mocks.api.sendTestEmail.mockResolvedValue(undefined)
    renderSheet()
    await user.click(screen.getByRole('button', { name: t('settings.email.editor.sendTest') }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.email.editor.testSent', { email: 't@mana.test' })))
    expect(mocks.api.sendTestEmail).toHaveBeenCalledExactlyOnceWith(TEMPLATE.key, {
      subject: TEMPLATE.subject,
      body: TEMPLATE.body,
      button_label: TEMPLATE.button_label,
    })
  })

  it('a save refreshes the email reads, never the preview', async () => {
    const user = userEvent.setup()
    mocks.api.saveEmailTemplate.mockResolvedValue(undefined)
    const { queryClient } = renderSheet()
    queryClient.setQueryData(emailKeys.sender(), { from_name: 'x' })
    await waitFor(() => expect(frame()).not.toBeNull())
    await user.type(body(), ' !')
    await user.click(screen.getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.email.editor.saved')))
    expect(queryClient.getQueryState(emailKeys.sender())?.isInvalidated).toBe(true)
    const previews = queryClient.getQueryCache().findAll({ queryKey: emailPreviewKeys.all })
    expect(previews.length).toBeGreaterThan(0)
    expect(previews.every((query) => !query.state.isInvalidated)).toBe(true)
  })

  it('asks before closing with unsaved changes', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet()
    await user.type(subject(), '!')
    await user.keyboard('{Escape}')
    const dialog = await screen.findByRole('alertdialog')
    expect(onClose).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: t('common.unsaved.leave') }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('TemplateEditorSheet — read-only (settings.view only)', () => {
  it('shows the text and its preview, with nothing to change, save or send', async () => {
    renderSheet({ readOnly: true })
    expect(subject()).toHaveAttribute('readonly')
    expect(body()).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: t('common.save') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('settings.email.editor.sendTest') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('settings.email.editor.reset') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('settings.email.editor.insert', { label: 'Nom de la clinique' }) })).not.toBeInTheDocument()
    // The variables are still listed, and the preview works (email-preview needs settings.view only).
    expect(screen.getByText('{{clinic.name}}')).toBeInTheDocument()
    await waitFor(() => expect(frame()).not.toBeNull())
  })

  it('a submit of the form saves nothing', async () => {
    renderSheet({ readOnly: true })
    // Any way the form could be submitted (an implicit submission, a future submit button).
    fireEvent.submit(subject().closest('form')!)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(mocks.api.saveEmailTemplate).not.toHaveBeenCalled()
  })
})

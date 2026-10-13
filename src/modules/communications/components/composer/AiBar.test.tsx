import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { AiBar, type AiBarProps } from './AiBar'

const mocks = vi.hoisted(() => ({ ai: { draftWithAi: vi.fn() } }))
vi.mock('../../api/ai', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/ai')>()), ...mocks.ai }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const A = 'modules.communications.ai'
afterEach(() => vi.clearAllMocks())

function renderBar(props: Partial<AiBarProps> = {}) {
  const onUse = vi.fn()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AiBar
        replying={false}
        draftText=""
        originalText=""
        subjectEmpty
        clientId="c1"
        threadId={null}
        capReached={false}
        disabled={false}
        onUse={onUse}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onUse }
}

const PROPOSAL = {
  text: 'Bonjour {{person.first_name}},\n\nMerci pour votre message.',
  subject: 'Suivi de votre demande',
  history: [
    { role: 'user' as const, content: 'Instruction: un suivi' },
    { role: 'assistant' as const, content: 'Objet: Suivi de votre demande\n\nBonjour…' },
  ],
}

describe('AiBar', () => {
  it('« Rédiger avec l’IA »: the instruction, Entrée sends; the proposal with its subject; « Utiliser »', async () => {
    mocks.ai.draftWithAi.mockResolvedValue(PROPOSAL)
    const user = userEvent.setup()
    const { onUse } = renderBar({ draftText: 'Mon brouillon' })
    await user.click(screen.getByRole('button', { name: t(`${A}.write`) }))
    await user.type(screen.getByRole('textbox', { name: t(`${A}.promptLabel`) }), 'Un suivi{Enter}')
    await waitFor(() =>
      expect(mocks.ai.draftWithAi).toHaveBeenCalledWith(
        { mode: 'write', instruction: 'Un suivi', draft: 'Mon brouillon', original: '', subjectEmpty: true, clientId: 'c1', threadId: null, history: [] },
      ),
    )
    const proposal = await screen.findByRole('region', { name: t(`${A}.proposal`) })
    expect(proposal).toHaveTextContent('Suivi de votre demande')
    await user.click(screen.getByRole('button', { name: t(`${A}.use`) }))
    expect(onUse).toHaveBeenCalledWith({ text: PROPOSAL.text, subject: PROPOSAL.subject })
    expect(screen.queryByRole('region', { name: t(`${A}.proposal`) })).not.toBeInTheDocument()
  })

  it('« Raffiner »: the instruction more, with the conversation; « Annuler » leaves the text', async () => {
    mocks.ai.draftWithAi.mockResolvedValueOnce(PROPOSAL).mockResolvedValueOnce({ ...PROPOSAL, text: 'Plus court.', subject: null })
    const user = userEvent.setup()
    const { onUse } = renderBar()
    await user.click(screen.getByRole('button', { name: t(`${A}.write`) }))
    await user.type(screen.getByRole('textbox', { name: t(`${A}.promptLabel`) }), 'Un suivi{Enter}')
    await screen.findByRole('region', { name: t(`${A}.proposal`) })
    await user.click(screen.getByRole('button', { name: t(`${A}.refine`) }))
    await user.type(screen.getByRole('textbox', { name: t(`${A}.refineLabel`) }), 'Plus court{Enter}')
    await waitFor(() => expect(mocks.ai.draftWithAi).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'refine', instruction: 'Plus court', history: PROPOSAL.history })))
    expect(await screen.findByText('Plus court.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t(`${A}.reject`) }))
    expect(screen.queryByRole('region', { name: t(`${A}.proposal`) })).not.toBeInTheDocument()
    expect(onUse).not.toHaveBeenCalled()
  })

  it('a reply: « Générer une réponse » at once, with the message replied to', async () => {
    mocks.ai.draftWithAi.mockResolvedValue({ ...PROPOSAL, subject: null })
    const user = userEvent.setup()
    renderBar({ replying: true, originalText: 'Bonjour, pouvez-vous me rappeler ?', subjectEmpty: false })
    await user.click(screen.getByRole('button', { name: t(`${A}.reply`) }))
    await waitFor(() =>
      expect(mocks.ai.draftWithAi).toHaveBeenCalledWith(expect.objectContaining({ mode: 'reply', instruction: '', original: 'Bonjour, pouvez-vous me rappeler ?', subjectEmpty: false })),
    )
  })

  it('a refusal shown as written; the cap reached: the button says so', async () => {
    mocks.ai.draftWithAi.mockRejectedValue(
      new FunctionCallError('invalid_request', 400, 'Le plafond mensuel de l’IA est atteint (50 $).', { refusal: true }),
    )
    const user = userEvent.setup()
    renderBar()
    await user.click(screen.getByRole('button', { name: t(`${A}.write`) }))
    await user.type(screen.getByRole('textbox', { name: t(`${A}.promptLabel`) }), 'x{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Le plafond mensuel de l’IA est atteint (50 $).')
  })

  it('the cap reached: disabled, and said', () => {
    renderBar({ capReached: true })
    expect(screen.getByRole('button', { name: t(`${A}.write`) })).toBeDisabled()
    expect(screen.getByText(t(`${A}.capReached`))).toBeInTheDocument()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AiQuickBar, ComposerUiProvider, type ComposerAi } from '@pergolas-signature/email-ui/composer'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { composerText } from '../../lib/email-ui'
import { COMPOSER_UI_PORTS } from './composer-ui-ports'
import { useManaComposerAi, type ManaComposerAiArgs } from './use-composer-ai'

const mocks = vi.hoisted(() => ({ ai: { draftWithAi: vi.fn() }, toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('../../api/ai', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/ai')>()), ...mocks.ai }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

afterEach(() => vi.clearAllMocks())

const PROPOSAL = {
  text: 'Bonjour {{person.first_name}},\n\nMerci pour votre message.',
  subject: 'Suivi de votre demande',
  history: [
    { role: 'user' as const, content: 'Instruction: un suivi' },
    { role: 'assistant' as const, content: 'Objet: Suivi de votre demande\n\nBonjour…' },
  ],
}

/** The composer's AI as `Composer` mounts it: PS Hub's bar over MANA's adapter (CM-24). */
function Bar({ args, bodyText = 'Mon brouillon', parentMessage }: { args?: Partial<ManaComposerAiArgs>; bodyText?: string; parentMessage?: string }) {
  const ai = useManaComposerAi({ original: '', subjectEmpty: true, clientId: 'c1', threadId: null, capReached: false, ...args })
  return (
    <AiQuickBar
      ai={ai}
      bodyText={bodyText}
      selection={null}
      onReplaceAll={onReplaceAll}
      onReplaceSelection={() => undefined}
      parentMessage={parentMessage}
      subject=""
      onSubjectChange={onSubjectChange}
    />
  )
}
const onReplaceAll = vi.fn()
const onSubjectChange = vi.fn()

function renderBar(props: Parameters<typeof Bar>[0] = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ComposerUiProvider ports={COMPOSER_UI_PORTS}>
        <Bar {...props} />
      </ComposerUiProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

describe('the composer AI: PS Hub’s bar over communications-draft (CM-24)', () => {
  it('« Rédiger avec l’IA »: the instruction, Entrée sends; the proposal and its subject; « Utiliser »', async () => {
    mocks.ai.draftWithAi.mockResolvedValue(PROPOSAL)
    const user = renderBar()
    await user.click(screen.getByRole('button', { name: composerText('aiBar.write') }))
    await user.type(screen.getByPlaceholderText(composerText('aiBar.customPlaceholderNew')), 'Un suivi{Enter}')
    await waitFor(() =>
      expect(mocks.ai.draftWithAi).toHaveBeenCalledWith({
        mode: 'write',
        instruction: 'Un suivi',
        draft: 'Mon brouillon',
        original: '',
        subjectEmpty: true,
        clientId: 'c1',
        threadId: null,
        history: [],
      }),
    )
    expect(await screen.findByText('Suivi de votre demande')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: composerText('aiBar.use') }))
    expect(onReplaceAll).toHaveBeenCalledWith(PROPOSAL.text)
    expect(onSubjectChange).toHaveBeenCalledWith('Suivi de votre demande')
  })

  it('a reply: « Générer une réponse » asks for one with no instruction and the message replied to', async () => {
    mocks.ai.draftWithAi.mockResolvedValue(PROPOSAL)
    const user = renderBar({ parentMessage: 'Puis-je venir mardi ?', args: { original: 'Puis-je venir mardi ?', threadId: 't1' } })
    await user.click(screen.getByRole('button', { name: t('modules.communications.ai.reply') }))
    await waitFor(() =>
      expect(mocks.ai.draftWithAi).toHaveBeenCalledWith(expect.objectContaining({ mode: 'reply', instruction: '', original: 'Puis-je venir mardi ?', threadId: 't1', history: [] })),
    )
  })

  it('a reply: « Ton de la réponse » offers the clinic’s three tones, and « Décliner poliment » sends its instruction (CM-29)', async () => {
    mocks.ai.draftWithAi.mockResolvedValue(PROPOSAL)
    const user = renderBar({ parentMessage: 'Puis-je venir mardi ?', args: { original: 'Puis-je venir mardi ?', threadId: 't1' } })
    await user.click(screen.getByRole('button', { name: composerText('aiBar.write') }))
    expect(screen.getByText(composerText('aiBar.toneGroup'))).toBeInTheDocument()
    for (const label of ['Demander des précisions', 'Décliner poliment', 'Remercier']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    await user.click(screen.getByRole('button', { name: 'Décliner poliment' }))
    await waitFor(() =>
      expect(mocks.ai.draftWithAi).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'reply',
          instruction: 'Décline poliment et brièvement, sans inventer de raison.',
          original: 'Puis-je venir mardi ?',
          threadId: 't1',
          history: [],
        }),
      ),
    )
  })

  it('a selection rewrite: the preset’s instruction, the passage and the text go to the server as « rewrite » (CM-29)', async () => {
    mocks.ai.draftWithAi.mockResolvedValue({ text: 'Merci beaucoup.', subject: null, history: [] })
    let port: ComposerAi | null = null
    function Probe() {
      port = useManaComposerAi({ original: '', subjectEmpty: false, clientId: null, threadId: 't1', capReached: false })
      return null
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Probe />
      </QueryClientProvider>,
    )
    const ai = port as unknown as ComposerAi
    expect(ai.presets.rewrite.map((preset) => preset.label)).toEqual(['Corriger', 'Reformuler', 'Développer', 'Raccourcir'])
    const result = await ai.draft({ kind: 'rewrite', preset: 'proofread', draft: 'Bonjour,\n\nMerci beaucou.', selection: 'Merci beaucou.' })
    expect(mocks.ai.draftWithAi).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'rewrite',
        instruction: "Corrige les fautes d'orthographe, de grammaire et de ponctuation sans changer le sens.",
        draft: 'Bonjour,\n\nMerci beaucou.',
        selection: 'Merci beaucou.',
        history: [],
      }),
    )
    expect(result.text).toBe('Merci beaucoup.')
    // The person's own words on a selection go as written.
    await ai.draft({ kind: 'rewrite', instruction: 'Plus chaleureux', draft: 'Merci.', selection: 'Merci.' })
    expect(mocks.ai.draftWithAi.mock.calls[1]?.[0]).toMatchObject({ mode: 'rewrite', instruction: 'Plus chaleureux', selection: 'Merci.' })
  })

  it('« Raffiner » continues the same conversation: the server’s history goes back', async () => {
    mocks.ai.draftWithAi.mockResolvedValue(PROPOSAL)
    const user = renderBar()
    await user.click(screen.getByRole('button', { name: composerText('aiBar.write') }))
    await user.type(screen.getByPlaceholderText(composerText('aiBar.customPlaceholderNew')), 'Un suivi{Enter}')
    await screen.findByText('Suivi de votre demande')
    await user.click(screen.getByRole('button', { name: composerText('aiBar.refine') }))
    await user.type(screen.getByPlaceholderText(composerText('aiBar.refinePlaceholder')), 'Plus court{Enter}')
    await waitFor(() => expect(mocks.ai.draftWithAi).toHaveBeenCalledTimes(2))
    expect(mocks.ai.draftWithAi.mock.calls[1]?.[0]).toMatchObject({ mode: 'refine', instruction: 'Plus court', history: PROPOSAL.history })
  })

  it('the month’s cap: no draft can be asked for, and the bar says why', () => {
    renderBar({ args: { capReached: true }, parentMessage: 'Puis-je venir mardi ?' })
    expect(screen.getByText(t('modules.communications.ai.capReached'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: composerText('aiBar.write') })).toBeDisabled()
    expect(screen.getByRole('button', { name: t('modules.communications.ai.reply') })).toBeDisabled()
  })

  it('a failure is said in MANA’s words', async () => {
    mocks.ai.draftWithAi.mockRejectedValue(new FunctionCallError('rate_limited', 429, 'Too many'))
    const user = renderBar({ parentMessage: 'Puis-je venir mardi ?' })
    await user.click(screen.getByRole('button', { name: t('modules.communications.ai.reply') }))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled())
    expect(String(mocks.toast.error.mock.calls[0]?.[0])).toContain(t('modules.communications.ai.errors.rateLimited'))
  })
})

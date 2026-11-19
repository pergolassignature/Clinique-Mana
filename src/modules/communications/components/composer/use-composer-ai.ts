import { useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AiDraftRequest, AiDraftResult, ComposerAi } from '@pergolas-signature/email-ui/composer'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import { aiErrorMessage, draftWithAi, type AiTurn } from '../../api/ai'
import { aiKeys } from '../../hooks/keys'

const A = 'modules.communications.ai'

/** « Générer une réponse »: the server writes a reply with no instruction (CM4). */
export const REPLY_PRESET = 'reply'

/**
 * The clinic's reply tones and PS Hub's four rewrite presets (CM-29): a key and its instruction, sent
 * as the person's own words would be. The server keeps its rules (no clinical information, the
 * names and numbers hidden) whatever the instruction says.
 */
export const TONE_PRESETS = [
  {
    key: 'ask_details',
    instruction: 'Réponds en demandant poliment les précisions qui manquent pour donner suite à la demande. Ne pose aucune question sans lien avec le message.',
  },
  { key: 'decline', instruction: 'Décline poliment et brièvement, sans inventer de raison.' },
  { key: 'thanks', instruction: 'Rédige une courte réponse de remerciement.' },
] as const
export const REWRITE_PRESETS = [
  { key: 'proofread', instruction: "Corrige les fautes d'orthographe, de grammaire et de ponctuation sans changer le sens." },
  {
    key: 'rephrase',
    instruction: 'Améliore la clarté et la fluidité de ce passage. Garde ce qui fonctionne déjà, les mêmes faits, la langue et le ton de la relation.',
  },
  { key: 'expand', instruction: 'Développe seulement les points utiles à la compréhension avec les faits fournis. N’invente aucun détail ni engagement.' },
  { key: 'shorten', instruction: 'Raccourcis ce passage sans perdre de fait, de date ni de demande.' },
] as const
const INSTRUCTIONS: ReadonlyMap<string, string> = new Map(
  [...TONE_PRESETS, ...REWRITE_PRESETS].map((preset) => [preset.key, preset.instruction] as const),
)

export interface ManaComposerAiArgs {
  /** The message replied to, as plain text ('' for a new message or a forward). */
  original: string
  subjectEmpty: boolean
  clientId: string | null
  threadId: string | null
  /** The month's cap is reached: no draft can be asked for. */
  capReached: boolean
}

/**
 * MANA's adapter for the composer's AI (PS Hub's bar and selection bubble, `@pergolas-signature/email-ui`,
 * CM-24, CM-29): `communications-draft` (the server hides the names and numbers from OpenAI and keeps to
 * the month's cap, CM-18/19), its four modes (write, reply, refine, rewrite) and its history. The
 * clinic's three reply tones and the four rewrite presets are instructions it sends. No file reading:
 * the server reads none.
 */
export function useManaComposerAi({ original, subjectEmpty, clientId, threadId, capReached }: ManaComposerAiArgs): ComposerAi {
  const queryClient = useQueryClient()
  // `draft` reads the latest values without a new port each keystroke.
  const latest = useRef({ original, subjectEmpty, clientId, threadId })
  latest.current = { original, subjectEmpty, clientId, threadId }

  const draft = useMemo(
    () =>
      async (request: AiDraftRequest): Promise<AiDraftResult> => {
        const now = latest.current
        // « Générer une réponse » sends no instruction (the server has its own); a preset, its instruction.
        const instruction = request.preset === REPLY_PRESET
          ? ''
          : request.preset
            ? (INSTRUCTIONS.get(request.preset) ?? '')
            : (request.instruction ?? '')
        try {
          const result = await draftWithAi({
            mode: request.kind,
            instruction,
            draft: request.draft,
            original: now.original,
            selection: request.kind === 'rewrite' ? (request.selection ?? '') : undefined,
            subjectEmpty: now.subjectEmpty,
            clientId: now.clientId,
            threadId: now.threadId,
            history: request.kind === 'refine' ? ((request.conversation as AiTurn[] | undefined) ?? []) : [],
          })
          return { text: result.text, subject: result.subject ?? undefined, conversation: result.history }
        } finally {
          // The status (the cap) and the month's use read again after each call.
          void queryClient.invalidateQueries({ queryKey: aiKeys.all })
        }
      },
    [queryClient],
  )

  return useMemo<ComposerAi>(
    () => ({
      draft,
      presets: {
        reply: [{ key: REPLY_PRESET, label: t(`${A}.reply`) }],
        tones: TONE_PRESETS.map(({ key }) => ({ key, label: t(`${A}.tones.${key}`) })),
        rewrite: REWRITE_PRESETS.map(({ key }) => ({ key, label: t(`${A}.rewrite.${key}`) })),
      },
      describeError: async (error) => ({ title: aiErrorMessage(error) }),
      notify: (title, detail) => {
        if (detail) toast.error(title, { description: detail })
        else toast.error(title)
      },
      unavailable: capReached ? t(`${A}.capReached`) : undefined,
    }),
    [draft, capReached],
  )
}

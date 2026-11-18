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
 * MANA's adapter for the composer's AI (PS Hub's bar, `@pergolas-signature/email-ui` 0.5.1, CM-24):
 * `communications-draft` (the server hides the names and numbers from OpenAI and keeps to the
 * month's cap, CM-18/19), its three modes (write, reply, refine) and its history. No tone, no
 * selection rewrite and no file reading: the server has none of them, so the bar offers none.
 */
export function useManaComposerAi({ original, subjectEmpty, clientId, threadId, capReached }: ManaComposerAiArgs): ComposerAi {
  const queryClient = useQueryClient()
  // `draft` reads the latest values without a new port each keystroke.
  const latest = useRef({ original, subjectEmpty, clientId, threadId })
  latest.current = { original, subjectEmpty, clientId, threadId }

  const draft = useMemo(
    () =>
      async (request: AiDraftRequest): Promise<AiDraftResult> => {
        // Never asked: MANA gives no rewrite preset and no `rewriteAi`.
        if (request.kind === 'rewrite') throw new Error('rewrite_not_supported')
        const now = latest.current
        try {
          const result = await draftWithAi({
            mode: request.kind,
            instruction: request.preset === REPLY_PRESET ? '' : (request.instruction ?? ''),
            draft: request.draft,
            original: now.original,
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
      presets: { reply: [{ key: REPLY_PRESET, label: t(`${A}.reply`) }], tones: [], rewrite: [] },
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

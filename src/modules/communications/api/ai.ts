import { z } from 'zod'
import { t } from '@/i18n'
import { supabase } from '@/core/supabase/client'
import { functionErrorText } from '@/core/supabase/function-errors'
import { invokeFunction } from '@/core/supabase/functions'

/*
 * « Rédiger avec l'IA » (CM4): whether the composer shows it (`get_ai_draft_status`), the draft
 * (`communications-draft`: the server hides the names and numbers from OpenAI, records the call
 * without its text and keeps to the monthly cap), and Paramètres → IA (`get_ai_settings`,
 * `set_ai_settings`; the key is an org secret, SecretField).
 */

const statusSchema = z.object({ available: z.boolean(), cap_reached: z.boolean() })
export type AiDraftStatus = z.output<typeof statusSchema>

export async function fetchAiDraftStatus(): Promise<AiDraftStatus> {
  const { data, error } = await supabase.rpc('get_ai_draft_status')
  if (error) throw error
  return statusSchema.parse(data)
}

export type AiDraftMode = 'write' | 'reply' | 'refine'
export interface AiTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AiDraftInput {
  mode: AiDraftMode
  instruction: string
  /** The editor's text above the quote (plain text). */
  draft: string
  /** The message replied to (plain text). */
  original: string
  subjectEmpty: boolean
  clientId: string | null
  threadId: string | null
  history: AiTurn[]
}

const draftSchema = z.object({
  text: z.string(),
  subject: z.string().nullable(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
})
export type AiDraft = z.output<typeof draftSchema>

/** What one call may carry: the function reads 64 KB at most. */
const CLIP = 8_000
const clip = (text: string) => (text.length > CLIP ? text.slice(-CLIP) : text)

export async function draftWithAi(input: AiDraftInput, signal?: AbortSignal): Promise<AiDraft> {
  const data = await invokeFunction(
    'communications-draft',
    {
      mode: input.mode,
      instruction: input.instruction,
      draft: clip(input.draft),
      original: clip(input.original),
      subject_empty: input.subjectEmpty,
      client_id: input.clientId,
      thread_id: input.threadId,
      history: input.history.slice(-8).map((turn) => ({ role: turn.role, content: clip(turn.content) })),
    },
    { signal },
  )
  return draftSchema.parse(data)
}

/** The French text of a failed draft: the server's refusal, the limit with its delay, OpenAI's state. */
export function aiErrorMessage(error: unknown): string {
  return (
    functionErrorText(error, {
      overrides: {
        rate_limited: () => t('modules.communications.ai.errors.rateLimited'),
        not_configured: () => t('modules.communications.ai.errors.notConfigured'),
        provider_error: () => t('modules.communications.ai.errors.providerError'),
      },
    }) ?? t('modules.communications.ai.errors.failed')
  )
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  model: z.string(),
  monthly_cap_cents: z.number().int(),
  input_cents_per_mtok: z.coerce.number(),
  output_cents_per_mtok: z.coerce.number(),
  key_configured: z.boolean(),
  month_requests: z.number().int(),
  month_spent_cents: z.coerce.number(),
  updated_at: z.string().nullable(),
})
export type AiSettings = z.output<typeof settingsSchema>

export async function fetchAiSettings(): Promise<AiSettings> {
  const { data, error } = await supabase.rpc('get_ai_settings')
  if (error) throw error
  return settingsSchema.parse(data)
}

export interface AiSettingsInput {
  enabled: boolean
  model: string
  monthlyCapCents: number
  inputCentsPerMtok: number
  outputCentsPerMtok: number
}

export async function saveAiSettings(input: AiSettingsInput): Promise<void> {
  const { error } = await supabase.rpc('set_ai_settings', {
    p_enabled: input.enabled,
    p_model: input.model,
    p_monthly_cap_cents: input.monthlyCapCents,
    p_input_cents_per_mtok: input.inputCentsPerMtok,
    p_output_cents_per_mtok: input.outputCentsPerMtok,
  })
  if (error) throw error
}

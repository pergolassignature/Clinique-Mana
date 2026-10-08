import { z } from 'zod'
import { FunctionCallError, invokeFunction } from '@/core/supabase/functions'

/** What `/invitation` shows for a valid staff invitation (`resolve_staff_invitation`). */
const displaySchema = z.object({
  clinic_name: z.string(),
  display_name: z.string(),
  email: z.string(),
  expires_at: z.string(),
})
export type InvitationDisplay = z.infer<typeof displaySchema>

const resolvedSchema = z.object({ purpose: z.literal('staff_invite'), display: displaySchema })
const acceptedSchema = z.object({ status: z.literal('accepted'), email: z.string() })

/**
 * What the token of `/invitation#t=…` opens (`resolve-link`; marks the link « opened »). A link of
 * another purpose is not this page's: it reads as `link_invalid`. Throws the function's refusal
 * (`link_invalid`, `link_expired`, `link_used`, `rate_limited`…) as a FunctionCallError.
 */
export async function resolveLink(token: string): Promise<InvitationDisplay> {
  const answer = resolvedSchema.safeParse(await invokeFunction('resolve-link', { token }))
  if (!answer.success) throw new FunctionCallError('link_invalid', 200, 'Not a staff invitation')
  return answer.data.display
}

/**
 * Creates the invitee's account with her password (`accept-invite`) and returns its address, for
 * the sign-in that follows. Throws the function's refusal (`conflict`, a link state,
 * `rate_limited`, `invalid_request` for a password Auth refused…) as a FunctionCallError.
 */
export async function acceptInvite(token: string, password: string): Promise<{ email: string }> {
  const answer = acceptedSchema.safeParse(await invokeFunction('accept-invite', { token, password }))
  if (!answer.success) throw new FunctionCallError('internal', 200, 'Unexpected answer')
  return { email: answer.data.email }
}

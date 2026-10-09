import { expect } from '@playwright/test'

/**
 * The local stack's Mailpit (`supabase start`, port 55324): the edge functions send there with
 * `EMAIL_TRANSPORT=mailpit` (supabase/functions/.env). Read through its API, never its web page.
 */
export const MAILPIT_URL = 'http://127.0.0.1:55324'

interface MailpitSummary {
  ID: string
  Subject: string
  To: { Address: string }[]
}

export interface MailpitMessage {
  ID: string
  Subject: string
  Text: string
  HTML: string
}

/** The newest message sent to `address`, waited for (the function sends after its RPC). */
export async function latestMessageTo(address: string, timeout = 15_000): Promise<MailpitMessage> {
  let found: MailpitSummary | undefined
  await expect
    .poll(
      async () => {
        const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=1`)
        if (!response.ok) return null
        const body = (await response.json()) as { messages: MailpitSummary[] }
        found = body.messages[0]
        return found?.ID ?? null
      },
      { timeout, message: `no email to ${address} in Mailpit (are the edge functions served with EMAIL_TRANSPORT=mailpit?)` },
    )
    .not.toBeNull()
  const response = await fetch(`${MAILPIT_URL}/api/v1/message/${found!.ID}`)
  expect(response.ok).toBe(true)
  return (await response.json()) as MailpitMessage
}

/**
 * The token of an invitation link in a message (`…/invitation#t=<43 base64url chars>`). The link's
 * origin is the functions' `APP_URL`, not the e2e server's: the spec opens the token on its own origin.
 */
export function invitationToken(message: MailpitMessage): string {
  const match = /\/invitation#t=([A-Za-z0-9_-]{43})/.exec(message.Text)
  if (!match?.[1]) throw new Error('no invitation link in the email')
  return match[1]
}

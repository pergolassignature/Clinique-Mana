/**
 * The Google application the busy-time functions (R6) use (AP-46): the calendars' own when both
 * of its org secrets are set (Paramètres → Agenda, « Application Google des agendas »: an
 * « Externe » app, so professionals with their own Google accounts can connect), else Gmail's
 * (`google_oauth_client_id` / `_secret`, « Courriels Gmail »). Values come from Vault through
 * `get_org_secret`, never from code or a request.
 *
 * A connection's refresh token works only with the application that issued it: after a change of
 * application, Google answers `unauthorized_client` and the connection asks to be reconnected
 * (`refreshAccessToken`).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { type OAuthApp, oauthApp } from '../gmail/credentials.ts'

/** The calendars' own Google application (org secrets, set in Paramètres → Agenda). */
export const SECRET_CALENDAR_CLIENT_ID = 'google_calendar_client_id'
export const SECRET_CALENDAR_CLIENT_SECRET = 'google_calendar_client_secret'

/** Which application answered: the calendars' own, or Gmail's. */
export type CalendarAppSource = 'calendar' | 'gmail'

/**
 * The application for the clinic's calendar connections, or null when neither is set. Throws
 * when a secret cannot be read (the callers report `oauth_app_unavailable`).
 */
export async function calendarOAuthApp(
  client: SupabaseClient,
  orgId: string,
): Promise<(OAuthApp & { source: CalendarAppSource }) | null> {
  const [id, secret] = await Promise.all([
    client.rpc('get_org_secret', {
      p_org_id: orgId,
      p_key: SECRET_CALENDAR_CLIENT_ID,
    }),
    client.rpc('get_org_secret', {
      p_org_id: orgId,
      p_key: SECRET_CALENDAR_CLIENT_SECRET,
    }),
  ])
  if (id.error || secret.error) throw new Error('secret_unavailable')
  if (
    typeof id.data === 'string' && id.data !== '' &&
    typeof secret.data === 'string' && secret.data !== ''
  ) {
    return { clientId: id.data, clientSecret: secret.data, source: 'calendar' }
  }
  const gmail = await oauthApp(client, orgId)
  return gmail ? { ...gmail, source: 'gmail' } : null
}

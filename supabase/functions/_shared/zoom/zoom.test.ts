import { assert, assertEquals, assertFalse } from '@std/assert'
import { meetingFields } from './client.ts'
import { redirectUri, zoomOrigins } from './env.ts'
import { urlValidationAnswer, verifyZoomSignature } from './webhook.ts'

Deno.test('zoom meetingFields: UTC start to the second, whole minutes, the clinic time zone', () => {
  assertEquals(
    meetingFields({
      startsAt: '2027-03-14T13:00:00.000+00:00',
      endsAt: '2027-03-14T13:50:00+00:00',
      timezone: 'America/Toronto',
    }),
    {
      start_time: '2027-03-14T13:00:00Z',
      duration: 50,
      timezone: 'America/Toronto',
    },
  )
})

Deno.test('zoom env: the fake is honoured only while APP_URL is local; the return path is fixed', () => {
  const local = (key: string) =>
    ({
      APP_URL: 'http://localhost:5173',
      ZOOM_OAUTH_BASE_URL: 'http://host.docker.internal:55394',
      ZOOM_API_BASE_URL: 'http://host.docker.internal:55394',
      ZOOM_OAUTH_PUBLIC_URL: 'http://127.0.0.1:55394',
    } as Record<string, string>)[key]
  assertEquals(zoomOrigins(local), {
    oauth: 'http://host.docker.internal:55394',
    oauthPublic: 'http://127.0.0.1:55394',
    api: 'http://host.docker.internal:55394',
  })
  const hosted = (key: string) =>
    key === 'APP_URL' ? 'https://app.cliniquemana.com' : local(key)
  assertEquals(zoomOrigins(hosted), {
    oauth: 'https://zoom.us',
    oauthPublic: 'https://zoom.us',
    api: 'https://api.zoom.us',
  })
  assertEquals(
    redirectUri(hosted),
    'https://app.cliniquemana.com/mon-agenda/videoconference',
  )
  assertEquals(
    redirectUri((key) => key === 'APP_URL' ? 'http://app.test' : undefined),
    null,
  )
})

Deno.test('zoom webhook: the signature is checked over v0:timestamp:body, within 5 minutes', async () => {
  const secret = 'secret-token'
  const body = '{"event":"app_deauthorized"}'
  const now = new Date('2026-10-13T15:00:00Z')
  const ts = String(Math.floor(now.getTime() / 1000))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = Array.from(
    new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(`v0:${ts}:${body}`),
      ),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('')
  assert(await verifyZoomSignature(secret, `v0=${mac}`, ts, body, now))
  assertFalse(
    await verifyZoomSignature(secret, `v0=${mac}`, ts, body + ' ', now),
  )
  assertFalse(await verifyZoomSignature('other', `v0=${mac}`, ts, body, now))
  assertFalse(
    await verifyZoomSignature(
      secret,
      `v0=${mac}`,
      ts,
      body,
      new Date(now.getTime() + 301_000),
    ),
  )
  assertFalse(await verifyZoomSignature(secret, mac, ts, body, now))
  assertFalse(await verifyZoomSignature(secret, null, ts, body, now))
  const answer = await urlValidationAnswer(secret, 'abc')
  assertEquals(answer.plainToken, 'abc')
  assertEquals(answer.encryptedToken.length, 64)
})

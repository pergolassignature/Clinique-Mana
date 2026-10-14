import { expect, test } from './fixtures/auth'
import { E2E_ORIGIN } from './fixtures/origin'

/**
 * Google busy times (Rendez-vous R6; local only, after `npm run db:reset`: the seed enables
 * Rendez-vous and holds the fake Google's OAuth client; provider@mana.test is Félix Gauthier's
 * account).
 *
 * 1. Always: « Agenda Google » in the professional's space says it is not connected.
 * 2. With the functions served (`npx supabase functions serve --env-file supabase/functions/.env`,
 *    `GOOGLE_CALENDAR_BASE_URL` set) and the fake Google (`npm run fake:gmail`): « Connecter mon
 *    agenda Google » goes through the fake's consent page and back; a busy time set in the fake
 *    shows « Occupé » (and nothing else) in « Mon agenda » after « Synchroniser »; « Déconnecter »
 *    ends it. Skipped when a piece is not running (CI).
 */

const API = 'http://127.0.0.1:55321'
const FAKE_GOOGLE = 'http://127.0.0.1:55392'

/** The clinic's calendar date `days` from today (America/Toronto). */
const clinicDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + days * 86_400_000),
  )

test('« Agenda Google » is in the professional’s space, not connected', async ({ page, signIn }) => {
  await signIn('provider')
  await page.getByRole('link', { name: 'Agenda Google' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Agenda Google' })).toBeVisible()
  await expect(page.getByText('Agenda Google non connecté', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connecter mon agenda Google' })).toBeVisible()
})

test('« Connecter mon agenda Google » through the fake Google, « Occupé » in the agenda, then « Déconnecter »', async ({ page, signIn, request }) => {
  const [fake, functions] = await Promise.all([
    request
      .post(`${FAKE_GOOGLE}/calendar/v3/freeBusy`, { data: {}, timeout: 2_000 })
      .then((r) => r.status() === 401)
      .catch(() => false),
    request
      .fetch(`${API}/functions/v1/google-calendar-connect`, { method: 'OPTIONS', headers: { Origin: E2E_ORIGIN }, timeout: 2_000 })
      .then((r) => r.ok())
      .catch(() => false),
  ])
  test.skip(!fake || !functions, 'the fake Google (with FreeBusy) or the edge functions are not running')

  // Tomorrow, 12:00–13:00 at the clinic (UTC−4 or −5: the fake takes instants; 16:00Z is noon or 11 h).
  const day = clinicDate(1)
  const busy = await request.post(`${FAKE_GOOGLE}/__fake/busy`, {
    data: [{ start: `${day}T16:00:00Z`, end: `${day}T17:00:00Z` }],
  })
  expect(busy.ok()).toBe(true)

  await signIn('provider')
  await page.goto('/mon-agenda/agenda-google')
  // The fake's consent page sends the browser back to the functions' APP_URL (the shared dev
  // server's origin): the consent is read here instead, and its return opened on this server.
  let consent: string | null = null
  await page.route(/^http:\/\/127\.0\.0\.1:55392\/o\/oauth2\/v2\/auth/, async (route) => {
    consent = route.request().url()
    await route.abort()
  })
  await page.getByRole('button', { name: 'Connecter mon agenda Google' }).click()
  await expect.poll(() => consent, { timeout: 15_000 }).not.toBeNull()
  expect(new URL(consent!).searchParams.get('scope')).toBe('openid email https://www.googleapis.com/auth/calendar.freebusy')
  const html = await (await request.get(consent!)).text()
  const href = /href="([^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&') ?? ''
  const back = new URL(href)
  await page.goto(`${back.pathname}${back.search}`)
  await expect(page).toHaveURL(`${E2E_ORIGIN}/mon-agenda/agenda-google`, { timeout: 15_000 })
  await expect(page.getByText('Agenda Google connecté', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/^Compte .+, connecté le/)).toBeVisible()
  await expect(page.getByText(/^Lu le .+ : 1 moment occupé dans les 62 prochains jours\.$/)).toBeVisible()

  await page.getByRole('button', { name: 'Synchroniser' }).click()
  await expect(page.getByText('Vos moments occupés sont à jour.')).toBeVisible()

  await page.goto(`/mon-agenda?vue=jour&date=${day}`)
  const block = page.getByTestId('agenda-busy')
  await expect(block).toHaveCount(1)
  await expect(block).toHaveText('Occupé')

  await page.goto('/mon-agenda/agenda-google')
  await page.getByRole('button', { name: 'Déconnecter', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Déconnecter', exact: true }).click()
  await expect(page.getByText('Agenda Google non connecté', { exact: true })).toBeVisible()
  await page.goto(`/mon-agenda?vue=jour&date=${day}`)
  await expect(page.getByTestId('agenda-busy')).toHaveCount(0)
})

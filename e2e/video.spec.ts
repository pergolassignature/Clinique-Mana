import { expect, test } from './fixtures/auth'
import { E2E_ORIGIN } from './fixtures/origin'

/**
 * Video links (Rendez-vous RZ; local only, after `npm run db:reset`: the seed enables Rendez-vous
 * and holds the fake Zoom's app; provider@mana.test is Félix Gauthier's account).
 *
 * 1. Always: the professional saves her fixed link in « Vidéoconférence »; the staff see her
 *    « Lien fixe » in Paramètres → Vidéoconférence.
 * 2. With the functions served (`npx supabase functions serve --env-file supabase/functions/.env`)
 *    and the fake Zoom (`npm run fake:zoom`): « Connecter mon Zoom » goes through the fake's consent
 *    page and back, then « Zoom connecté »; « Déconnecter » ends it. Skipped when a piece is not
 *    running (CI).
 */

const API = 'http://127.0.0.1:55321'
const FAKE_ZOOM = 'http://127.0.0.1:55394'
const LINK = 'https://meet.google.com/abc-defg-hij'

test('the professional saves her fixed link; the staff see it', async ({ page, signIn }) => {
  await signIn('provider')
  await page.getByRole('link', { name: 'Vidéoconférence' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Vidéoconférence' })).toBeVisible()
  await expect(page.getByText(/^Zoom n.est pas connecté$/)).toBeVisible()
  const field = page.getByRole('textbox', { name: /^Adresse du lien/ })
  await field.fill('meet.google.com/abc')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText(/^Entrez l.adresse complète du lien/)).toBeVisible()
  await field.fill(LINK)
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Lien fixe enregistré.')).toBeVisible()

  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await signIn('admin')
  await page.goto('/parametres/videoconference')
  await expect(page.getByRole('heading', { level: 1, name: 'Vidéoconférence' })).toBeVisible()
  const felix = page.getByRole('listitem').filter({ has: page.getByText('Félix Gauthier', { exact: true }) })
  await expect(felix.getByText('Lien fixe', { exact: true })).toBeVisible()
  await expect(felix.getByText(LINK, { exact: true })).toBeVisible()
})

test('« Connecter mon Zoom » through the fake Zoom, then « Déconnecter »', async ({ page, signIn, request }) => {
  const [fake, functions] = await Promise.all([
    request.get(`${FAKE_ZOOM}/v2/users/me`, { timeout: 2_000 }).then((r) => r.status() === 401).catch(() => false),
    request
      .fetch(`${API}/functions/v1/zoom-connect`, { method: 'OPTIONS', headers: { Origin: E2E_ORIGIN }, timeout: 2_000 })
      .then((r) => r.ok())
      .catch(() => false),
  ])
  test.skip(!fake || !functions, 'the fake Zoom or the edge functions are not running')

  await signIn('provider')
  await page.goto('/mon-agenda/videoconference')
  // The fake's consent page sends the browser back to the functions' APP_URL (the shared dev
  // server's origin): that return is redirected to this server, where the session is.
  await page.route(/^http:\/\/localhost:5173\/mon-agenda\/videoconference\?/, (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({ status: 302, headers: { Location: `${E2E_ORIGIN}${url.pathname}${url.search}` } })
  })
  await page.getByRole('button', { name: 'Connecter mon Zoom' }).click()
  await expect(page).toHaveURL(`${E2E_ORIGIN}/mon-agenda/videoconference`, { timeout: 15_000 })
  await expect(page.getByText('Zoom connecté', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/^Compte pro\.zoom@exemple\.test, connecté le/)).toBeVisible()

  await page.getByRole('button', { name: 'Déconnecter' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Déconnecter' }).click()
  await expect(page.getByText(/^Zoom n.est pas connecté$/)).toBeVisible()
})

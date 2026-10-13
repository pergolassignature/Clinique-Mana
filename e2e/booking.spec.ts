import { expect, test } from './fixtures/auth'
import { latestMessageTo } from './fixtures/mailpit'
import { E2E_ORIGIN } from './fixtures/origin'

/**
 * The public discovery-call booking page that replaces Calendly (Demandes D3c; local only, after
 * `npm run db:reset`: the seed opens booking every day 8 h – 20 h).
 *
 * 1. Always: Paramètres → Appels découverte shows the page's address for the website's button.
 * 2. With the functions served (`npx supabase functions serve --env-file supabase/functions/.env`):
 *    the page opened with a campaign's utm_* → a slot, the person, « Comment avez-vous entendu
 *    parler de MANA ? » → « réservé » (the proof-of-work check solved by the page) → the
 *    confirmation in Mailpit → its cancel link → « Annuler l'appel » → cancelled. Skipped when the
 *    functions do not answer (CI).
 */

const API = 'http://127.0.0.1:55321'
const ORG = '00000000-0000-0000-0000-000000000001'

test('Paramètres → Appels découverte: the page’s address for the website', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto('/parametres/appels-decouverte')
  await expect(page.getByRole('heading', { level: 1, name: 'Appels découverte' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Adresse de la page' })).toHaveValue(`${E2E_ORIGIN}/appel-decouverte?clinique=${ORG}`)
  await expect(page.getByRole('switch', { name: 'Réservation en ligne ouverte' })).toBeChecked()
})

test('a discovery call booked on the public page, confirmed by email, cancelled by its link', async ({ page, request }) => {
  const up = await request
    .fetch(`${API}/functions/v1/demandes-book-call`, { method: 'OPTIONS', headers: { Origin: E2E_ORIGIN }, timeout: 2_000 })
    .then((r) => r.ok())
    .catch(() => false)
  test.skip(!up, 'the edge functions are not running')
  test.setTimeout(60_000)
  const email = `appel.e2e.${Date.now()}@mana.test`

  await page.goto(`/appel-decouverte?clinique=${ORG}&utm_source=e2e&utm_campaign=essai`)
  await expect(page.getByRole('heading', { level: 1, name: 'Réserver un appel découverte' })).toBeVisible()
  await page.getByRole('radio').first().check({ force: true })
  await page.getByRole('textbox', { name: /^Prénom/ }).fill('Essai')
  await page.getByRole('textbox', { name: /^Nom/ }).fill('Réservation')
  await page.getByRole('textbox', { name: /^Courriel/ }).fill(email)
  await page.getByRole('textbox', { name: /^Téléphone/ }).fill('514 555-0199')
  const heard = page.getByRole('combobox', { name: /entendu parler de MANA/ })
  if (await heard.count()) await heard.selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Réserver l’appel' }).click()
  await expect(page.getByRole('heading', { name: 'Votre appel est réservé' })).toBeVisible({ timeout: 20_000 })

  const message = await latestMessageTo(email)
  const token = /\/appel-decouverte\/annuler#t=([A-Za-z0-9_-]{43})/.exec(message.Text)?.[1]
  expect(token, 'a cancel link in the email').toBeTruthy()

  await page.goto(`/appel-decouverte/annuler#t=${token}`)
  await expect(page).toHaveURL(`${E2E_ORIGIN}/appel-decouverte/annuler`)
  await expect(page.getByText(/est prévu le/)).toBeVisible()
  await page.getByRole('button', { name: 'Annuler l’appel' }).click()
  await expect(page.getByRole('heading', { name: 'Appel annulé' })).toBeVisible()
})

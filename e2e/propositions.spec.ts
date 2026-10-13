import { expect, test } from './fixtures/auth'
import { latestMessageTo } from './fixtures/mailpit'
import { E2E_ORIGIN } from './fixtures/origin'

/**
 * A proposal (Demandes D3b; local only, after `npm run db:reset`: Rendez-vous is on and Félix
 * Gauthier is available Monday to Friday 9:00–17:00). Needs the edge functions served
 * (`npx supabase functions serve --env-file supabase/functions/.env`, EMAIL_TRANSPORT=mailpit);
 * skipped when they do not answer.
 *
 * The counselor takes a request with an email, makes its file, accepts it, proposes Félix with one
 * of his free slots (held 48 h); the person opens the email's link, chooses the slot: it is booked
 * and the request is « Jumelée ».
 */

const API = 'http://127.0.0.1:55321'

test('a professional proposed, the slot chosen by the person through the link, the request matched', async ({ page, request, signIn }) => {
  const up = await request
    .fetch(`${API}/functions/v1/demandes-propose`, { method: 'OPTIONS', headers: { Origin: E2E_ORIGIN }, timeout: 2_000 })
    .then((r) => r.ok())
    .catch(() => false)
  test.skip(!up, 'the edge functions are not running')
  test.setTimeout(90_000)
  const stamp = Date.now() % 100000
  const name = `Rose Propo${[...String(stamp)].map((digit) => 'abcdefghij'[Number(digit)]).join('')}`
  const email = `proposition.e2e.${Date.now()}@mana.test`

  await signIn('counselor')
  await page.getByRole('link', { name: 'Demandes', exact: true }).first().click()
  await page.getByRole('button', { name: 'Nouvelle demande' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nouvelle demande' })
  await dialog.getByRole('textbox', { name: 'Nom' }).fill(name)
  await dialog.getByRole('textbox', { name: 'Courriel' }).fill(email)
  await dialog.getByRole('button', { name: 'Créer la demande' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  // Her file (Clients' picker, prefilled with the address), then « Acceptée ».
  await page.getByRole('button', { name: 'Rattacher un dossier' }).click()
  await page.getByRole('button', { name: 'Nouveau client' }).click()
  await page.getByRole('dialog', { name: 'Nouveau client' }).getByRole('button', { name: 'Créer le dossier' }).click()
  await expect(page.getByText('Le dossier est rattaché.')).toBeVisible()
  await page.getByRole('combobox', { name: "Changer l'état" }).selectOption('accepted')

  // The proposal: Félix, his first service, one free slot.
  await page.getByRole('tab', { name: 'Suivi' }).click()
  await page.getByRole('button', { name: 'Proposer un professionnel' }).click()
  const form = page.getByRole('dialog', { name: 'Proposer un professionnel' })
  const pro = form.getByRole('combobox', { name: 'Professionnel' })
  await pro.selectOption((await pro.locator('option', { hasText: 'Félix' }).first().getAttribute('value'))!)
  await form.getByRole('combobox', { name: 'Service' }).selectOption({ index: 1 })
  await form.getByRole('checkbox').first().check()
  await form.getByRole('button', { name: /Envoyer la proposition/ }).click()
  await expect(page.getByText('Proposition envoyée : les plages sont réservées 48 h.')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/En attente de réponse/)).toBeVisible()

  // The person: the link, one slot, booked.
  const message = await latestMessageTo(email)
  const token = /\/proposition#t=([A-Za-z0-9_-]{43})/.exec(message.Text)?.[1]
  expect(token, 'a link in the email').toBeTruthy()
  const person = await page.context().newPage()
  await person.goto(`/proposition#t=${token}`)
  await expect(person).toHaveURL(`${E2E_ORIGIN}/proposition`)
  await expect(person.getByText(/vous propose un premier rendez-vous avec Félix/)).toBeVisible()
  await person.getByRole('radio').first().check()
  await person.getByRole('button', { name: 'Choisir cette plage' }).click()
  await expect(person.getByRole('heading', { name: "C'est réservé !" })).toBeVisible({ timeout: 20_000 })

  // The counselor sees it.
  await page.reload()
  await expect(page.getByText(/Acceptée : premier rendez-vous le/)).toBeVisible()
  await expect(page.locator('header').getByText('Jumelée', { exact: true })).toBeVisible()
})

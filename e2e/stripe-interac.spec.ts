import { expect, test } from './fixtures/auth'
import { E2E_ORIGIN } from './fixtures/origin'

/**
 * Facturation FS (local only, after `npm run db:reset`: the seed enables Facturation and holds the
 * fake Stripe's keys).
 *
 * 1. « Virements Interac »: the adjointe types a transfer notice, finds it « À rapprocher », ignores
 *    it with a reason, then finds it among « Ignorés ».
 * 2. « Carte au dossier » in Alice's « Visites et paiements »: no card, the link button; with the
 *    functions served and the fake Stripe (`npm run fake:stripe`), « Envoyer le lien pour
 *    enregistrer une carte » sends it. Skipped when a piece is not running (CI).
 */

const API = 'http://127.0.0.1:55321'
const FAKE_STRIPE = 'http://127.0.0.1:55397'

test('« Virements Interac »: a notice typed, ignored, then listed among the ignored', async ({ page, signIn }) => {
  const stamp = Date.now() % 100000
  const sender = `E2E Expéditeur ${stamp}`
  await signIn('adminAssistant')
  await page.getByRole('link', { name: 'Virements Interac' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Virements Interac' })).toBeVisible()
  await page.getByLabel(/^Montant/).fill(`1,${String(stamp % 100).padStart(2, '0')}`)
  await page.getByLabel(/^Expéditeur/).fill(sender)
  await page.getByRole('button', { name: 'Ajouter l’avis' }).click()
  await expect(page.getByText('Avis ajouté : choisissez la facture à rapprocher.')).toBeVisible()
  const card = page.getByRole('listitem').filter({ hasText: sender })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Ignorer' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^Raison/).fill('Essai de bout en bout')
  await dialog.getByRole('button', { name: 'Ignorer' }).click()
  await expect(page.getByText('Avis ignoré.')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: sender })).toHaveCount(0)
  await page.getByRole('button', { name: 'Ignorés' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: sender })).toContainText('Ignoré : Essai de bout en bout')
})

test('« Carte au dossier »: no card yet, the link sent (with the functions and the fake Stripe)', async ({ page, signIn, request }) => {
  const [fake, functions] = await Promise.all([
    request.get(`${FAKE_STRIPE}/v1/customers`, { timeout: 2_000 }).then((r) => r.status() === 401).catch(() => false),
    request
      .fetch(`${API}/functions/v1/billing-stripe`, { method: 'OPTIONS', headers: { Origin: E2E_ORIGIN }, timeout: 2_000 })
      .then((r) => r.ok())
      .catch(() => false),
  ])
  await signIn('adminAssistant')
  await page.goto('/clients')
  await page.getByRole('link', { name: /Alice Tremblay-Fictive/ }).first().click()
  await page.getByRole('tab', { name: 'Visites et paiements' }).click()
  const panel = page.getByRole('region', { name: 'Carte au dossier' })
  await expect(panel).toBeVisible()
  const send = panel.getByRole('button', { name: /^(Envoyer le lien pour enregistrer une carte|Renvoyer le lien)$/ }).first()
  await expect(send).toBeVisible()
  test.skip(!fake || !functions, 'the fake Stripe or the edge functions are not running')
  await send.click()
  await expect(page.getByText(/^Lien envoyé à /)).toBeVisible()
  await expect(panel.getByText(/^Lien envoyé le /).first()).toBeVisible()
})

import { expect, test } from './fixtures/auth'
import type { Page } from '@playwright/test'

/**
 * « Textos » (batch SM; local only, after `npm run db:reset`: the seed enables Communications and
 * stores the fake PBX's settings and secrets).
 *
 * 1. Always: the admin records a consent for a new number (« Nouveau numéro ») → its thread opens
 *    with the clinic's consent text waiting for the dispatch → the reply box is there → she
 *    withdraws the consent → no reply box any more. Paramètres → Textos shows the webhook address.
 * 2. With the fake PBX (`npm run fake:yeastar`) and the functions served (`npx supabase functions
 *    serve --env-file supabase/functions/.env`): a reply leaves through the PBX (« Envoyé »), a
 *    text from the client arrives through the signed webhook, then « ARRÊT » withdraws the consent
 *    and the acknowledgement is sent. Skipped when the fake does not answer (CI).
 *
 * Numbers are fictitious (555-01xx-style ranges), one per run.
 */

const FAKE_PBX = 'http://127.0.0.1:55393'

/** A fresh fictitious number per run: « 514 555-xxxx » (never ending in 0000, which the fake refuses). */
function freshNumber(): { typed: string; shown: string; e164: string } {
  const last = String(1000 + Math.floor(Math.random() * 8999))
  return { typed: `514555${last}`, shown: `514 555-${last}`, e164: `+1514555${last}` }
}

async function openTextos(page: Page) {
  await page.getByRole('link', { name: 'Textos' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Textos' })).toBeVisible()
}

async function recordConsent(page: Page, typed: string, shown: string) {
  await page.getByRole('button', { name: 'Nouveau numéro' }).click()
  const dialog = page.getByRole('dialog', { name: 'Consentement aux textos' })
  await dialog.getByRole('textbox', { name: /^Numéro de téléphone/ }).fill(typed)
  await dialog.getByRole('textbox', { name: /^Comment le consentement/ }).fill('Au téléphone (test e2e)')
  await dialog.getByRole('button', { name: 'Enregistrer le consentement' }).click()
  await expect(dialog).toBeHidden()
  const thread = page.getByRole('region', { name: `Conversation avec ${shown}` })
  await expect(thread).toBeVisible()
  return thread
}

test('the admin records a consent: the consent text waits for the dispatch; a withdrawal removes the reply box', async ({ page, signIn }) => {
  const number = freshNumber()
  await signIn('admin')
  await openTextos(page)

  const thread = await recordConsent(page, number.typed, number.shown)
  await expect(thread.getByText('Consentement donné')).toBeVisible()
  await expect(thread.getByText('Texte de consentement')).toBeVisible()
  await expect(thread.getByText('En attente', { exact: true })).toBeVisible()
  await expect(thread.getByRole('textbox', { name: 'Votre réponse' })).toBeVisible()

  await thread.getByRole('button', { name: 'Retirer le consentement' }).click()
  const withdraw = page.getByRole('dialog', { name: 'Retirer le consentement aux textos' })
  await withdraw.getByRole('button', { name: 'Retirer le consentement' }).click()
  await expect(withdraw).toBeHidden()
  await expect(thread.getByText('Consentement retiré')).toBeVisible()
  await expect(thread.getByRole('textbox', { name: 'Votre réponse' })).toHaveCount(0)
  await expect(thread.getByText(/a retiré son consentement/)).toBeVisible()

  // Paramètres → Textos: the address to paste on the PBX, the seed's number.
  await page.goto('/parametres/textos')
  await expect(page.getByRole('heading', { level: 1, name: 'Textos' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Adresse à donner à la centrale' })).toHaveValue(/\/functions\/v1\/sms-webhook\?org=/)
  await expect(page.getByRole('textbox', { name: /^Numéro de textos de la clinique/ })).toHaveValue('418 555-0199')
})

test('with the fake PBX: a reply leaves, a text arrives, « ARRÊT » withdraws the consent', async ({ page, signIn, request }) => {
  const up = await request.get(`${FAKE_PBX}/__fake/messages`, { timeout: 2_000 }).then((r) => r.ok()).catch(() => false)
  test.skip(!up, 'the fake PBX is not running (npm run fake:yeastar)')
  test.setTimeout(60_000)
  const number = freshNumber()
  await signIn('admin')
  await openTextos(page)
  const thread = await recordConsent(page, number.typed, number.shown)

  // A reply, sent at once through the PBX.
  await thread.getByRole('textbox', { name: 'Votre réponse' }).fill('Bonjour, votre rendez-vous est confirmé.')
  await thread.getByRole('button', { name: 'Envoyer' }).click()
  await expect(thread.getByText('Bonjour, votre rendez-vous est confirmé.')).toBeVisible()
  await expect(thread.getByText('Envoyé', { exact: true })).toBeVisible({ timeout: 15_000 })

  // The client answers: the PBX posts the signed event; the thread shows it once reloaded.
  const inbound = await request.post(`${FAKE_PBX}/__fake/inbound`, { data: { from: number.e164, body: 'Merci, à demain.' } })
  expect((await inbound.json()).webhook_status).toBe(200)
  await page.reload()
  await page.getByRole('list', { name: 'Conversations' }).getByRole('button', { name: new RegExp(number.shown) }).click()
  await expect(page.getByText('Merci, à demain.')).toBeVisible()

  // « ARRÊT »: the consent is withdrawn and acknowledged.
  const stop = await request.post(`${FAKE_PBX}/__fake/inbound`, { data: { from: number.e164, body: 'ARRÊT' } })
  expect((await stop.json()).webhook_status).toBe(200)
  await page.reload()
  await page.getByRole('list', { name: 'Conversations' }).getByRole('button', { name: new RegExp(number.shown) }).click()
  const after = page.getByRole('region', { name: `Conversation avec ${number.shown}` })
  await expect(after.getByText('Consentement retiré')).toBeVisible()
  await expect(after.getByText('Confirmation du retrait')).toBeVisible()
})

test('SM-16: Alice’s file lists her mobile under « Textos »; « Textos » offers « À rattacher » and the search', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto('/clients')
  await page.getByRole('link', { name: /Alice Tremblay-Fictive/ }).first().click()
  await page.getByRole('tab', { name: 'Courriels' }).click()
  const numbers = page.getByRole('list', { name: 'Numéros du dossier' })
  await expect(numbers).toContainText('514 555-0201')
  await expect(numbers).toContainText('Cellulaire')
  await numbers.getByRole('button', { name: 'Ouvrir la conversation avec le 514 555-0201' }).click()
  await expect(page.getByRole('region', { name: 'Conversation avec 514 555-0201' })).toBeVisible()

  await openTextos(page)
  await page.getByRole('button', { name: 'À rattacher' }).click()
  await page.getByRole('searchbox').fill('aucun-client-de-ce-nom')
  await expect(page.getByText('Aucune conversation ne correspond.')).toBeVisible()
})

import { expect, test } from './fixtures/auth'
import { latestMessageTo } from './fixtures/mailpit'
import { E2E_ORIGIN } from './fixtures/origin'
import type { Page } from '@playwright/test'

/**
 * Client consents (batch C5a; local only, after `npm run db:reset`: the seed enables Clients and
 * holds one fictitious client, « Camille Exemple », with a Mailpit address).
 *
 * 1. Always: the admin publishes the French « Consentement général » (Paramètres → Consentements),
 *    after which its rule can be switched on; « Consentements à obtenir » opens.
 * 2. With the functions served (`npx supabase functions serve --env-file supabase/functions/.env`,
 *    `DOCUMENSO_PUBLIC_URL` set) and the fake Documenso (`npm run fake:documenso`; the app built
 *    with `VITE_DOCUMENSO_URL` so the frame is allowed): a request sent through
 *    `clients-consent-send` → listed « En attente » → its email in Mailpit → the public page
 *    (identity, « Oui / Non », the embedded signature) → « Merci ! » → no longer to obtain.
 *    Skipped when a piece is not running (CI). Then « Envoyer la copie signée » (C5b): the
 *    sealed PDF attached to an email in Mailpit, « Copie envoyée le … ».
 * 3. Always (C5b): « Retirer le consentement » on the seed's imported consent (Amélie Tremblay):
 *    a note, then « Retiré le … ».
 */

const API = 'http://127.0.0.1:55321'
const FAKE_DOCUMENSO = 'http://127.0.0.1:55390'
const CLIENT_ID = 'c11e0000-0000-0000-0000-000000000001'
const CLIENT_EMAIL = 'camille.exemple@mana.test'
const AMELIE_ID = 'c11e0000-0000-0000-0000-000000000002'

async function publishGeneralFrench(page: Page) {
  await page.goto('/parametres/consentements')
  await expect(page.getByRole('heading', { level: 1, name: 'Consentements' })).toBeVisible()
  const general = page.getByRole('listitem').filter({ has: page.getByText('Consentement général', { exact: true }) }).first()
  const french = general.getByText(/^Français\s:/)
  await expect(french).toBeVisible()
  if ((await french.textContent())?.includes('Brouillon (pas encore publié)')) {
    await general.locator('div', { has: page.getByText(/^Français\s:/) }).getByRole('button', { name: 'Publier' }).click()
    const dialog = page.getByRole('dialog', { name: /^Publier «\sConsentement général\s»$/ })
    await expect(dialog.getByRole('radio', { name: /Les nouveaux clients seulement/ })).toBeChecked()
    await dialog.getByRole('button', { name: 'Publier' }).click()
    await expect(dialog).toBeHidden()
  }
  await expect(french).toHaveText(/Version 1 publiée le/)
}

/** The signed-in user's access token, from supabase-js's storage (`AUTH_STORAGE_KEY`), to call a function as that user. */
async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => (JSON.parse(localStorage.getItem('clinique-mana-auth') ?? '{}') as { access_token?: string }).access_token ?? null)
  if (!token) throw new Error('no session in storage')
  return token
}

test('the admin publishes « Consentement général »: its rule can be switched on; the list opens', async ({ page, signIn }) => {
  await signIn('admin')
  await publishGeneralFrench(page)
  const rule = page.getByRole('switch', { name: /^Activer la règle «\sConsentement général\s»$/ })
  await expect(rule).toBeEnabled()
  await expect(page.getByRole('switch', { name: /^Activer la règle «\sNaturopathie\s»$/ })).toBeDisabled()

  await page.getByRole('link', { name: 'Consentements', exact: true }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Consentements à obtenir' })).toBeVisible()
})

test('« Modifier le texte » opens a consent text in the shared editor (CC-12): the provisional line said, no « Publier » there', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto('/parametres/consentements')
  await page.getByRole('button', { name: /^Modifier le texte\s: Naturopathie \(français\)$/ }).click()
  const editor = page.getByRole('region', { name: /^Texte\s: Naturopathie \(français\)$/ })
  await expect(editor.getByRole('heading', { name: /^Texte\s: Naturopathie \(français\)$/ })).toBeFocused()
  await expect(editor.getByText(/^Ce brouillon est encore le texte provisoire/)).toBeVisible()
  await expect(editor.getByRole('textbox', { name: /^Texte du document/ })).toHaveValue(/\{\{consent\.clauses\}\}/)
  await expect(editor.getByRole('button', { name: /^Publier la version/ })).toHaveCount(0)
  await expect(editor.getByText(/accord requis/)).toHaveCount(0) // the sample lives in the preview's frame
  await expect(editor.frameLocator('iframe').getByText(/accord requis/)).toBeVisible()
  // CC-13: the draft's « Oui / Non » clauses under the text, editable.
  await expect(editor.getByRole('textbox', { name: /^Clause 1/ })).toHaveValue(/^Clause provisoire/)
  await editor.getByRole('button', { name: 'Fermer le texte' }).click()
  await expect(editor).toBeHidden()
})

test('sent, signed on the public page through the fake Documenso, then no longer to obtain', async ({ page, signIn, request }) => {
  const [fake, functions] = await Promise.all([
    request.get(`${FAKE_DOCUMENSO}/__fake/documents`, { timeout: 2_000 }).then((r) => r.ok()).catch(() => false),
    request
      .fetch(`${API}/functions/v1/clients-consent-send`, { method: 'OPTIONS', headers: { Origin: E2E_ORIGIN }, timeout: 2_000 })
      .then((r) => r.ok())
      .catch(() => false),
  ])
  test.skip(!fake || !functions, 'the fake Documenso or the edge functions are not running')
  test.setTimeout(90_000)

  await signIn('admin')
  await publishGeneralFrench(page)

  // « Envoyer » (the record's tab comes with C3): the same call, as the admin.
  const sent = await request.post(`${API}/functions/v1/clients-consent-send`, {
    headers: { Authorization: `Bearer ${await accessToken(page)}`, Origin: E2E_ORIGIN, 'Content-Type': 'application/json' },
    data: { action: 'send', client_id: CLIENT_ID, consent_key: 'general', context_type: 'record', context_id: CLIENT_ID },
  })
  expect(sent.status()).toBe(200)
  expect(((await sent.json()) as { signers: { sent: boolean }[] }).signers).toEqual([expect.objectContaining({ role: 'client', sent: true })])

  await page.goto('/clients/consentements')
  const row = page.getByRole('row').filter({ hasText: 'Camille Exemple' })
  await expect(row).toContainText('Consentement général')
  await expect(row).toContainText('En attente')
  await row.getByRole('button', { name: 'Voir les consentements de Camille Exemple' }).click()
  const sheet = page.getByRole('dialog', { name: 'Consentements de Camille Exemple' })
  await expect(sheet.getByText('En attente de signature')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Renvoyer' })).toBeVisible()
  await page.keyboard.press('Escape')

  // The client's email: the link's origin is the functions' APP_URL; opened on this server.
  const email = await latestMessageTo(CLIENT_EMAIL)
  const token = /\/consentement#t=([A-Za-z0-9_-]{43})/.exec(email.Text)?.[1]
  expect(token, 'a consent link in the email').toBeTruthy()

  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/consentement#t=${token}`)
  await expect(page.getByText(/^Clinique MANA \(local\) vous demande de signer «\sConsentement général\s»\.$/)).toBeVisible()
  await expect(page).toHaveURL(`${E2E_ORIGIN}/consentement`)
  await page.getByRole('textbox', { name: /^Prénom du client/ }).fill('Camille')
  await page.getByRole('textbox', { name: /^Année de naissance du client/ }).fill('1990')
  await page.getByRole('button', { name: 'Continuer' }).click()

  await expect(page.getByRole('group', { name: 'Vos réponses' })).toBeVisible()
  for (const yes of await page.getByRole('radio', { name: 'Oui' }).all()) await yes.check()
  await page.getByRole('button', { name: 'Lire et signer' }).click()

  const frame = page.frameLocator('iframe')
  await frame.getByRole('button', { name: 'Signer' }).click({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: /^Merci\s!$/ })).toBeVisible({ timeout: 20_000 })

  // The webhook stored the sealed PDF; the capture made the consent in force.
  await signIn('admin')
  await expect(async () => {
    await page.goto('/clients/consentements')
    await expect(page.getByRole('heading', { level: 1, name: 'Consentements à obtenir' })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Camille Exemple' })).toHaveCount(0)
  }).toPass({ timeout: 20_000 })

  // C5b: « Envoyer la copie signée » from the record: the sealed PDF attached, the copy recorded.
  await page.goto(`/clients/${CLIENT_ID}/consentements`)
  const general = page.getByRole('listitem').filter({ has: page.getByText('Consentement général', { exact: true }) })
  await general.getByRole('button', { name: 'Envoyer la copie signée' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Envoyer la copie signée' })
  await confirm.getByRole('button', { name: 'Envoyer la copie' }).click()
  await expect(page.getByText('Copie envoyée.')).toBeVisible()
  await expect(general.getByText(/^Copie envoyée le /)).toBeVisible()
  const copy = (await latestMessageTo(CLIENT_EMAIL)) as Awaited<ReturnType<typeof latestMessageTo>> & { Attachments?: { FileName: string; ContentType: string }[] }
  expect(copy.Subject).toMatch(/^Copie signée\s: Consentement général/)
  expect(copy.Attachments?.map((a) => [a.FileName, a.ContentType])).toEqual([['Consentement général (signé).pdf', 'application/pdf']])
})

test('« Retirer le consentement »: a note, then « Retiré le … » (C5b, CC-16)', async ({ page, signIn }) => {
  await signIn('admin')
  await page.goto(`/clients/${AMELIE_ID}/consentements`)
  const general = page.getByRole('listitem').filter({ has: page.getByText('Consentement général', { exact: true }) })
  await expect(general.getByText('Importé de GOrendezvous')).toBeVisible()
  // No sealed PDF for an imported signature: no copy to send.
  await expect(general.getByRole('button', { name: 'Envoyer la copie signée' })).toHaveCount(0)
  await general.getByRole('button', { name: 'Retirer le consentement' }).click()
  const dialog = page.getByRole('alertdialog', { name: /^Retirer «\sConsentement général\s»$/ })
  const note = dialog.getByRole('textbox', { name: /^Note/ })
  await expect(note).toBeFocused()
  await dialog.getByRole('button', { name: 'Retirer le consentement' }).click()
  await expect(dialog.getByText(/^Notez comment le retrait a été reçu/)).toBeVisible()
  await note.fill('Retrait demandé au téléphone (essai local).')
  await dialog.getByRole('button', { name: 'Retirer le consentement' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Consentement retiré.')).toBeVisible()
  await expect(general.getByText('Retiré', { exact: true })).toBeVisible()
  await expect(general.getByText(/^Retiré le /)).toBeVisible()
  await expect(general.getByRole('button', { name: 'Retirer le consentement' })).toHaveCount(0)
})

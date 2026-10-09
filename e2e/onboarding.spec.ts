import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from './fixtures/auth'
import { invitationToken, latestMessageTo } from './fixtures/mailpit'
import type { Locator, Page } from '@playwright/test'

/**
 * The invitation path of plan Task 4b.7 (local only, after `npm run db:reset`). Needs the edge
 * functions served (`npx supabase functions serve --env-file supabase/functions/.env`) with
 * `EMAIL_TRANSPORT=mailpit`, `APP_URL=http://localhost:5173` and the e2e origin
 * (`http://localhost:5190`) in `ALLOWED_ORIGINS` (`.env.example` lists it).
 *
 * The adjointe creates and invites a professional → the invitation email is read in Mailpit → its
 * link is opened, a password chosen → every questionnaire step, with fixture files for the photo and
 * the insurance → « Envoyer mon profil » → the adjointe reviews and applies it → « Questionnaire
 * approuvé » is done. Each run uses a fresh address, so a second run on the same database passes.
 */

const RECORD_URL = /\/professionnels\/[0-9a-f-]{36}\/apercu$/
const FILES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'files')

/** Forgets the signed-in user (as the professionals spec does): the next page starts signed out. */
async function signOutHard(page: Page) {
  await page.context().clearCookies()
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
}

/** The questionnaire's current step, by its title (the step's h2). */
async function expectStep(page: Page, title: string) {
  await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible()
}

/** « Continuer » (or the step's own label), then the next step's title. */
async function continueTo(page: Page, next: string, button = 'Continuer') {
  await page.getByRole('main').getByRole('button', { name: button, exact: true }).click()
  await expectStep(page, next)
}

/** Opens a set step's picker, ticks `names` (searched when the list is long), saves. */
async function pick(page: Page, open: string, names: string[], search = false) {
  await page.getByRole('button', { name: open }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  for (const name of names) {
    const box = search ? sheet.getByRole('searchbox') : null
    if (box) await box.fill(name)
    await sheet.getByRole('checkbox', { name, exact: true }).click()
    if (box) await box.fill('')
  }
  await sheet.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(sheet).toBeHidden()
}

/** Uploads a fixture through the step's dropzone (its hidden file input), then waits for « reçue ». */
async function upload(step: Locator, file: string, received: string) {
  await step.locator('input[type="file"]').setInputFiles(path.join(FILES, file))
  await expect(step.getByText(received, { exact: true })).toBeVisible({ timeout: 15_000 })
}

test('the adjointe invites a professional, who completes the questionnaire, and the adjointe applies it', async ({ page, signIn }) => {
  test.setTimeout(180_000)
  const stamp = Date.now()
  const firstName = 'Noémie'
  const lastName = `Accueil${stamp}`
  const fullName = `${firstName} ${lastName}`
  const email = `noemie.${stamp}@exemple.test`
  // A test password for this run only (never a real one): the account exists on the local stack.
  const password = `Essai-${stamp}-Mana`

  // 1. The adjointe creates the file and sends the invitation at once.
  await signIn('adminAssistant')
  await page.getByRole('link', { name: 'Professionnels' }).first().click()
  await page.getByRole('button', { name: 'Ajouter' }).click()
  const create = page.getByRole('dialog', { name: 'Ajouter un professionnel' })
  await create.getByRole('textbox', { name: /^Prénom/ }).fill(firstName)
  await create.getByRole('textbox', { name: /^Nom/ }).fill(lastName)
  await create.getByRole('textbox', { name: /^Courriel/ }).fill(email)
  await create.getByLabel('Profession').selectOption({ label: 'Psychologue' })
  await create.getByRole('textbox', { name: /^N° de permis/ }).fill(String(stamp).slice(-5))
  await expect(create.getByRole('checkbox', { name: "Envoyer l'invitation maintenant" })).toBeChecked()
  await create.getByRole('button', { name: 'Créer et inviter' }).click()
  await expect(page).toHaveURL(RECORD_URL)
  const recordUrl = page.url()
  await expect(page.getByRole('heading', { level: 1, name: fullName })).toBeVisible()
  await expect(page.getByText('Invité', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/^Invitation envoyée le .+ · expire le /)).toBeVisible()

  // 2. The invitation email, read in Mailpit.
  const message = await latestMessageTo(email)
  expect(message.Subject).toContain("Bienvenue dans l'équipe")
  expect(message.Text).toContain(`Bonjour ${firstName},`)
  const token = invitationToken(message)

  // 3. The link, opened signed out: a password, then the questionnaire (P4-266).
  await signOutHard(page)
  await page.goto(`/invitation#t=${token}`)
  await expect(page.getByRole('heading', { name: /^Bienvenue chez / })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Courriel' })).toHaveValue(email)
  await page.getByLabel(/^Mot de passe/).fill(password)
  await page.getByLabel(/^Confirmer le mot de passe/).fill(password)
  await page.getByRole('button', { name: 'Activer mon compte' }).click()
  await expect(page).toHaveURL(/\/mon-profil\/questionnaire/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Compléter mon profil' })).toBeVisible()
  const main = page.getByRole('main')

  // Renseignements personnels.
  await expectStep(page, 'Renseignements personnels')
  await main.getByRole('textbox', { name: /^Téléphone/ }).fill('514 555-0142')
  const line1 = main.getByRole('combobox', { name: /^Adresse/ })
  await line1.fill("120 rue de l'Essai")
  // Address suggestions (when the places fake runs) must not cover the next fields.
  await line1.press('Escape')
  await main.getByRole('textbox', { name: /^Ville/ }).fill('Montréal')
  await main.getByRole('textbox', { name: /^Code postal/ }).fill('H2X 1Y4')
  await continueTo(page, 'Profil professionnel')

  // Profil professionnel: the title and licence come from the file; the years are added.
  await expect(main.getByRole('combobox', { name: /^Titre/ })).toHaveValue(/.+/)
  await main.getByRole('textbox', { name: "Années d'expérience" }).fill('8')
  await continueTo(page, 'Portrait')

  await main.getByRole('textbox', { name: /^Présentation/ }).fill("J'accompagne les adultes dans les périodes de changement, avec écoute et respect.")
  await continueTo(page, 'Langues')

  // Langues: French is on file; continuing confirms it.
  await expect(main.getByText('Français', { exact: true })).toBeVisible()
  await continueTo(page, 'Clientèles')

  await pick(page, 'Choisir mes clientèles', ['Adultes (18 ans et plus)'])
  await expect(main.getByText('Adultes (18 ans et plus)')).toBeVisible()
  await continueTo(page, 'Motifs')

  await pick(page, 'Choisir mes motifs', ['Anxiété', 'Deuil'], true)
  await expect(main.getByText('Anxiété', { exact: true })).toBeVisible()
  await continueTo(page, 'Disponibilités générales')

  await main.getByRole('checkbox', { name: 'Soir', exact: true }).click()
  await continueTo(page, 'Photo')

  // Photo and Assurance: fixture files through the real uploads (storage-upload → storage-confirm).
  await upload(main, 'photo.png', 'Photo reçue.')
  await continueTo(page, 'Assurance')
  await upload(main, 'insurance.pdf', "Preuve d'assurance reçue.")
  // The expiry is proposed (the next March 31).
  await expect(main.getByLabel(/^Date d'échéance/)).toHaveValue(/^\d{4}-03-31$/)
  await continueTo(page, 'Fiscalité et banque')

  // Fiscalité et banque: saved on « Continuer » only, encrypted at once (no SIN: not collected).
  await main.getByRole('textbox', { name: /^Institution/ }).fill('815')
  await main.getByRole('textbox', { name: /^Transit/ }).fill('30000')
  await main.getByRole('textbox', { name: /^Numéro de compte/ }).fill('7654321')
  await continueTo(page, 'Consentement')

  // Consentement: signed through Documenso once the clinic publishes the form (P4-487); the seed's is
  // a draft, so the step says it comes later and never blocks the sending.
  await expect(main.getByText(/^La clinique n'a pas encore publié ce formulaire/)).toBeVisible()
  await continueTo(page, 'Révision et envoi')

  // Révision: every step complete, then « Envoyer mon profil ».
  await expect(main.getByText('Toutes les étapes sont complètes. Vérifiez vos réponses, puis envoyez votre profil.')).toBeVisible()
  await main.getByRole('button', { name: 'Envoyer mon profil' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Profil envoyé' })).toBeVisible({ timeout: 15_000 })

  // 4. The adjointe reviews the questionnaire (Documents) and applies every change.
  await signOutHard(page)
  await signIn('adminAssistant')
  await expect(async () => {
    await page.goto(recordUrl.replace(/\/apercu$/, '/documents'))
    await expect(page.getByRole('heading', { level: 1, name: fullName })).toBeVisible()
  }).toPass({ timeout: 15_000 })
  await expect(page.getByText('À réviser', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: /^Réviser/ }).click()
  const sheet = page.getByRole('dialog', { name: `Réviser le profil de ${fullName}` })
  await expect(sheet).toBeVisible()
  const apply = sheet.getByRole('button', { name: /^Appliquer les changements sélectionnés \(\d+\)$/ })
  await expect(apply).toBeEnabled()
  await apply.click()
  await expect(sheet).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText(/^Questionnaire approuvé : \d+ changements? appliqués? au dossier\.$/)).toBeVisible()

  // Aperçu: the questionnaire is approved; the file waits for activation (« En préparation », P4-43).
  await page.getByRole('tab', { name: 'Aperçu' }).click()
  await expect(page.getByText('Questionnaire approuvé (terminé)')).toBeVisible()
  await expect(page.getByText('Compte créé (invitation acceptée) (terminé)')).toBeVisible()
  await expect(page.getByText('En préparation', { exact: true }).first()).toBeVisible()
})

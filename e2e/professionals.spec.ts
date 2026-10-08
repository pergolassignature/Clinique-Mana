import { expect, test } from './fixtures/auth'
import type { Locator, Page } from '@playwright/test'

/**
 * The Professionnels path of plan Task 4a.20 (local only, after `npm run db:reset`: the specs sign
 * in with the seed logins and read the seeded professionals). Each run creates one professional
 * with a fresh address, so a second run on the same database passes too; `db:reset` removes them.
 * The conseillère's test puts back the motif it adds.
 */

const RECORD_URL = /\/professionnels\/[0-9a-f-]{36}\/apercu$/

/** A record tab (real Radix tabs: one tab stop, the URL follows). */
async function openTab(page: Page, name: string) {
  await page.getByRole('tab', { name }).click()
  await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
}

/** Opens a Jumelage picker by its « Modifier les … » button; returns the sheet. */
async function openPicker(page: Page, button: string): Promise<Locator> {
  await page.getByRole('button', { name: button }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  return sheet
}

/** Saves a picker: one set RPC, then the sheet closes. */
async function savePicker(sheet: Locator) {
  await sheet.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(sheet).toBeHidden()
}

/** Ticks a motif found through the picker's search (accents ignored by the search). */
async function tickMotif(sheet: Locator, name: string) {
  const search = sheet.getByRole('searchbox', { name: 'Rechercher dans la liste' })
  await search.fill(name)
  await sheet.getByRole('checkbox', { name, exact: true }).click()
  await search.fill('')
}

test('the adjointe creates and matches a professional, the admin activates it, and it is found by language', async ({
  page,
  signIn,
}) => {
  const stamp = Date.now()
  const lastName = `Essai${stamp}`
  const fullName = `Rosalie ${lastName}`
  await signIn('adminAssistant')

  // List → « Ajouter ».
  await page.getByRole('link', { name: 'Professionnels' }).first().click()
  await expect(page).toHaveURL(/\/professionnels$/)
  await page.getByRole('button', { name: 'Ajouter' }).click()
  const create = page.getByRole('dialog', { name: 'Ajouter un professionnel' })
  await create.getByRole('textbox', { name: /^Prénom/ }).fill('Rosalie')
  await create.getByRole('textbox', { name: /^Nom/ }).fill(lastName)
  await create.getByRole('textbox', { name: /^Courriel/ }).fill(`rosalie.${stamp}@exemple.test`)
  await create.getByLabel('Profession').selectOption({ label: 'Psychologue' })
  // Psychologue belongs to an order: its licence field appears (P4-35).
  await create.getByRole('textbox', { name: /^N° de permis/ }).fill(String(stamp).slice(-5))
  await create.getByRole('button', { name: 'Créer' }).click()

  // The record opens on Aperçu, with the matching profile still to complete.
  await expect(page).toHaveURL(RECORD_URL)
  await expect(page.getByRole('heading', { level: 1, name: fullName })).toBeVisible()
  await expect(page.getByText('Complétez le profil de jumelage.')).toBeVisible()

  // Jumelage: two clientèles (Adolescents ★) from 14 years old, three motifs, English. No approaches (P4-240).
  await openTab(page, 'Jumelage')
  let sheet = await openPicker(page, 'Modifier les clientèles')
  await sheet.getByRole('checkbox', { name: 'Adolescents (13 à 17 ans)' }).click()
  await sheet.getByRole('checkbox', { name: 'Adultes (18 ans et plus)' }).click()
  await sheet
    .getByRole('listitem')
    .filter({ hasText: 'Adolescents (13 à 17 ans)' })
    .getByRole('button', { name: 'Marquer comme spécialisé' })
    .click()
  await savePicker(sheet)

  sheet = await openPicker(page, 'Modifier les motifs')
  for (const motif of ['Anxiété', 'Deuil', 'Estime de soi']) await tickMotif(sheet, motif)
  await expect(sheet.getByText('Sélection : 3 sur 124')).toBeVisible()
  await savePicker(sheet)
  // Every held motif by name, under its category's title (P4-249).
  const motifs = page.getByRole('region', { name: 'Motifs' })
  for (const name of ['Santé mentale / Troubles psychologiques', 'Anxiété', 'Estime de soi', 'Autres', 'Deuil']) {
    await expect(motifs.getByText(name, { exact: true })).toBeVisible()
  }
  await expect(page.getByRole('heading', { name: 'Approches' })).toHaveCount(0)

  // Limites de clientèle (P4-245): the youngest client age reads on the youngest age group.
  const limits = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Limites de clientèle' }) })
  await limits.getByRole('textbox', { name: 'Âge minimum des clients' }).fill('14')
  await limits.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('region', { name: 'Clientèles' }).getByText('Adolescents (14 ans et plus)')).toBeVisible()

  sheet = await openPicker(page, 'Modifier les langues')
  await sheet.getByRole('checkbox', { name: 'Anglais' }).click()
  await savePicker(sheet)

  await expect(page.getByRole('region', { name: 'Langues' }).getByText('Anglais')).toBeVisible()

  // Aperçu: the matching profile is complete; the account and the questionnaire are still to come
  // (4b.1, P4-179), so only the admin can activate, with the override reason.
  await openTab(page, 'Aperçu')
  await expect(page.getByText("Le profil de jumelage est complet. Il reste l'accès du professionnel et son questionnaire.")).toBeVisible()
  const recordUrl = page.url()

  // The admin activates it: « Activer » → « Activer quand même » with the suggested reason → Actif.
  await page.context().clearCookies()
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await signIn('admin')
  // Straight to the record (not through the list, whose search the admin's filters would remember).
  // Accueil may still be navigating right after the sign-in: retry an aborted load.
  await expect(async () => {
    await page.goto(recordUrl)
    await expect(page.getByRole('heading', { level: 1, name: fullName })).toBeVisible()
  }).toPass({ timeout: 15_000 })
  // The header's teal « Activer » (Aperçu's « Prochaine action » may have one too, later in the page).
  await page.getByRole('main').getByRole('button', { name: 'Activer', exact: true }).first().click()
  const confirm = page.getByRole('alertdialog', { name: `Activer ${fullName} ?` })
  await confirm.getByRole('textbox', { name: /^Raison de l'activation/ }).fill('Dossier complété hors application')
  await confirm.getByRole('button', { name: 'Activer quand même' }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByText('Actif', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('À inviter', { exact: true })).toHaveCount(0)

  // List: « Langue : Anglais » finds the new professional.
  await page.getByRole('navigation', { name: "Fil d'Ariane" }).getByRole('link', { name: 'Professionnels' }).click()
  await expect(page).toHaveURL(/\/professionnels(\?.*)?$/)
  await page.getByRole('button', { name: /^Filtres/ }).click()
  await page.getByLabel('Langue', { exact: true }).selectOption({ label: 'Anglais' })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('group', { name: 'Filtres actifs' }).getByText('Langue : Anglais')).toBeVisible()
  await expect(page).toHaveURL(/langue=/)
  await page.getByRole('searchbox', { name: 'Rechercher un professionnel' }).fill(lastName)
  await expect(page.getByRole('link', { name: new RegExp(fullName) })).toBeVisible()
  // The list remembers the user's filters (P4-60, written after a 1.5 s pause): « Réinitialiser »
  // forgets them. Checked from a fresh load, which reads the saved filters from the server again.
  await page.getByRole('button', { name: 'Réinitialiser' }).click()
  await expect(page.getByRole('group', { name: 'Filtres actifs' })).toHaveCount(0)
  await expect(async () => {
    await page.goto('/professionnels')
    await expect(page.getByRole('table', { name: 'Professionnels' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Filtres actifs' })).toHaveCount(0)
    await expect(page).toHaveURL(/\/professionnels$/)
  }).toPass({ timeout: 15_000 })

  // Historique shows the activation.
  await page.goto(recordUrl.replace(/\/apercu$/, '/historique'))
  await expect(page.getByText('a activé le dossier')).toBeVisible()
  await expect(page.getByText('a créé le dossier')).toBeVisible()
})

test('the conseillère cannot add, edits motifs, and reads Identité et permis only', async ({ page, signIn }) => {
  await signIn('counselor')
  await page.getByRole('link', { name: 'Professionnels' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Professionnels' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Étienne Fortin/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ajouter' })).toHaveCount(0)

  // Étienne Fortin (seed 07): add « Phobies » to his motifs, then put it back as it was.
  await page.goto('/professionnels/5eed0000-0000-0000-0000-000000000007/jumelage')
  await expect(page.getByRole('heading', { level: 1, name: 'Étienne Fortin' })).toBeVisible()
  let sheet = await openPicker(page, 'Modifier les motifs')
  await tickMotif(sheet, 'Phobies')
  await savePicker(sheet)
  await expect(page.getByText('Modifications enregistrées.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Motifs' }).getByText('Phobies')).toBeVisible()
  sheet = await openPicker(page, 'Modifier les motifs')
  await tickMotif(sheet, 'Phobies')
  await savePicker(sheet)
  await expect(page.getByRole('region', { name: 'Motifs' }).getByText('Phobies')).toHaveCount(0)

  // Identité et permis: one read-only notice, fields read-only, nothing to save.
  await openTab(page, 'Identité et permis')
  const panel = page.getByRole('tabpanel')
  await expect(panel.getByText('Seules les personnes qui gèrent les dossiers des professionnels peuvent modifier ces informations.')).toBeVisible()
  await expect(panel.getByRole('textbox', { name: /^Prénom/ })).toHaveAttribute('readonly', '')
  await expect(panel.getByRole('button', { name: 'Enregistrer' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Activer' })).toHaveCount(0)
})

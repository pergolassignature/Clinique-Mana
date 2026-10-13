import { expect, test } from './fixtures/auth'

/**
 * Demandes, the parity gaps (local only, after `npm run db:reset`): the intake's follow-up
 * questions (« Enjeux », « Contexte légal ») kept and cleared by « Non », a couple request that
 * says it counts one person, and « Jumelée » by hand with the seed's Félix Gauthier (a person
 * booked by phone). Fictional names, one per run.
 */
test('the intake\'s follow-ups, the couple count, and a match by hand', async ({ page, signIn }) => {
  const stamp = Date.now() % 100000
  const name = `Rose Parite${[...String(stamp)].map((digit) => 'abcdefghij'[Number(digit)]).join('')}`

  await signIn('counselor')
  await page.getByRole('link', { name: 'Demandes', exact: true }).first().click()
  await page.getByRole('button', { name: 'Nouvelle demande' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nouvelle demande' })
  await dialog.getByRole('textbox', { name: 'Nom' }).fill(name)
  await dialog.getByRole('button', { name: 'Créer la demande' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  // « Enjeux » Oui → Coparentalité with a comment; « Contexte légal » Oui → DPJ; saved, then read back.
  await page.getByRole('combobox', { name: 'Pour qui' }).selectOption('couple')
  await page.getByRole('combobox', { name: 'Enjeux' }).selectOption('yes')
  await page.getByRole('checkbox', { name: 'Coparentalité' }).check()
  await page.getByRole('textbox', { name: 'Précisions sur les enjeux' }).fill('Garde partagée')
  await page.getByRole('combobox', { name: 'Contexte légal' }).selectOption('yes')
  await page.getByRole('checkbox', { name: 'DPJ' }).check()
  await page.getByRole('button', { name: 'Enregistrer' }).last().click()
  await expect(page.getByText("L'accueil est enregistré.")).toBeVisible()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Coparentalité' })).toBeChecked()
  await expect(page.getByRole('textbox', { name: 'Précisions sur les enjeux' })).toHaveValue('Garde partagée')

  // « Non » clears what follows.
  await page.getByRole('combobox', { name: 'Contexte légal' }).selectOption('no')
  await expect(page.getByRole('checkbox', { name: 'DPJ' })).toBeHidden()
  await page.getByRole('button', { name: 'Enregistrer' }).last().click()
  await expect(page.getByText("L'accueil est enregistré.").first()).toBeVisible()
  await page.reload()
  await page.getByRole('combobox', { name: 'Contexte légal' }).selectOption('yes')
  await expect(page.getByRole('checkbox', { name: 'DPJ' })).not.toBeChecked()
  await page.getByRole('combobox', { name: 'Contexte légal' }).selectOption('no')

  // A couple with nobody listed yet: said, never blocked.
  await page.getByRole('tab', { name: 'Participants' }).click()
  await expect(page.getByText('Une demande de couple vise deux personnes. Participants inscrits : 0.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ajouter un dossier de la clinique' })).toBeVisible()

  // « Jumelée » by hand, from « Acceptée ».
  await page.getByRole('combobox', { name: "Changer l'état" }).selectOption('accepted')
  await expect(page.getByText('La demande est maintenant « Acceptée ».')).toBeVisible()
  await page.getByRole('combobox', { name: "Changer l'état" }).selectOption('matched')
  const match = page.getByRole('dialog', { name: 'Jumeler la demande' })
  const pro = match.getByRole('combobox', { name: 'Professionnel' })
  const value = await pro.locator('option', { hasText: 'Félix Gauthier' }).first().getAttribute('value')
  await pro.selectOption(value!)
  await match.getByRole('button', { name: 'Jumeler' }).click()
  await expect(page.getByText('La demande est jumelée à Félix Gauthier.')).toBeVisible()
  await expect(page.getByText('Jumelée', { exact: true }).first()).toBeVisible()
})

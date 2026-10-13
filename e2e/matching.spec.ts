import { expect, test } from './fixtures/auth'

/**
 * The matching panel (Demandes D4; local only, after `npm run db:reset`): the counselor opens a
 * new request's « Jumelage » tab and reads what the request says, the suggestions in their order
 * and, folded, the professionals left out with why. The seed's Félix Gauthier is listed (eligible
 * or not, depending on the seed's readiness), never hidden.
 */
test('the counselor reads the matching panel of a request: criteria, suggestions, the others with why', async ({ page, signIn }) => {
  const stamp = Date.now() % 100000
  const name = `Jade Jumel${[...String(stamp)].map((digit) => 'abcdefghij'[Number(digit)]).join('')}`

  await signIn('counselor')
  await page.getByRole('link', { name: 'Demandes', exact: true }).first().click()
  await page.getByRole('button', { name: 'Nouvelle demande' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nouvelle demande' })
  await dialog.getByRole('textbox', { name: 'Nom' }).fill(name)
  await dialog.getByRole('button', { name: 'Créer la demande' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  await page.getByRole('tab', { name: 'Jumelage' }).click()
  await expect(page).toHaveURL(/\/jumelage$/)
  await expect(page.getByRole('heading', { name: 'Ce que la demande indique' })).toBeVisible()
  await expect(page.getByText(/^Français · /)).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Admissibles \(\d+\)$/ })).toBeVisible()

  const others = page.getByRole('button', { name: /^Non admissibles \(\d+\)$/ })
  if (await others.isVisible()) await others.click()
  await expect(page.getByText('Félix Gauthier').first()).toBeVisible()
  // The seed's files are not complete yet (no account, no approved questionnaire): left out, and why.
  await expect(page.getByText(/Dossier incomplet/).first()).toBeVisible()
})

/**
 * The waiting list meets the matching (D4 part 2): a professional's list shows who she could be
 * offered (the seed's files are not complete yet, so nobody: said plainly).
 */
test('a professional’s waiting list says who she could be offered', async ({ page, signIn }) => {
  await signIn('counselor')
  await page.getByRole('link', { name: "Liste d'attente" }).first().click()
  const list = page.getByRole('combobox', { name: 'Liste' })
  const value = await list.locator('option', { hasText: 'Félix Gauthier' }).first().getAttribute('value')
  await list.selectOption(value!)
  await expect(page).toHaveURL(/liste=p-/)
  await expect(page.getByRole('heading', { name: 'Personnes compatibles avec Félix Gauthier' })).toBeVisible()
  await expect(page.getByText(/Personne de compatible n'attend Félix Gauthier/)).toBeVisible()
})

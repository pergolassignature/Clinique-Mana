import { expect, test } from './fixtures/auth'

/**
 * The availability board (Demandes D5; local only, after `npm run db:reset`): the counselor opens
 * « Places des professionnels », sets Félix Gauthier's places with « Recommencer le décompte » and
 * reads them on the board.
 */
test('the counselor sets a professional’s places from the board and reads them there', async ({ page, signIn }) => {
  await signIn('counselor')
  await page.getByRole('link', { name: 'Places des professionnels' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Places des professionnels' })).toBeVisible()
  const table = page.getByRole('table', { name: 'Places des professionnels' })
  await expect(table.getByRole('link', { name: 'Félix Gauthier' })).toBeVisible()

  await page.getByRole('button', { name: 'Modifier les places de Félix Gauthier' }).click()
  const dialog = page.getByRole('dialog', { name: 'Places de Félix Gauthier' })
  await dialog.getByRole('textbox', { name: 'Places offertes' }).fill('2')
  await dialog.getByRole('checkbox', { name: /Recommencer le décompte/ }).check()
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Places de Félix Gauthier enregistrées.')).toBeVisible()
  const felix = table.getByRole('row', { name: /Félix Gauthier/ })
  await expect(felix.getByText('2 sur 2 restantes')).toBeVisible()

  // « Avec des places » keeps him; the URL names the view.
  await page.getByRole('tab', { name: /^Avec des places/ }).click()
  await expect(page).toHaveURL(/vue=avec-places/)
  await expect(table.getByRole('link', { name: 'Félix Gauthier' })).toBeVisible()
})

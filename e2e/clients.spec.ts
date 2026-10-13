import { expect, test } from './fixtures/auth'

/**
 * Clients (plan C3.6; local only, after `npm run db:reset`: the seed enables the module and holds
 * five fictional files). The admin finds a seeded file, is stopped from creating it twice, creates
 * a new person, then adds a parent with rights from « Proches ». Each run creates its own file
 * (a stamped name), so a second run on the same database passes too. The provider login (Félix,
 * seed) sees her own clients only, never the clinic list (CL-5).
 */

test('the admin is stopped on a duplicate, creates a file and adds a parent with rights', async ({ page, signIn }) => {
  const stamp = Date.now()
  const firstName = `Essai${stamp}`
  await signIn('admin')
  await page.goto('/clients')
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()
  const table = page.getByRole('table', { name: 'Clients' })
  await expect(table.getByRole('link', { name: 'Alice Tremblay-Fictive' })).toBeVisible()

  // The search is by name, number, email or phone.
  await page.getByRole('searchbox', { name: 'Rechercher un client' }).fill('gagnon')
  await expect(table.getByRole('link', { name: 'Marc Gagnon-Fictif' })).toBeVisible()
  await expect(table.getByRole('link', { name: 'Alice Tremblay-Fictive' })).toBeHidden()
  await page.getByRole('searchbox', { name: 'Rechercher un client' }).fill('')

  // « Nouveau client »: the seeded file is found while typing; creation is refused.
  await page.getByRole('button', { name: 'Nouveau client' }).click()
  const sheet = page.getByRole('dialog', { name: 'Nouveau client' })
  await sheet.getByRole('textbox', { name: /^Prénom/ }).fill('Alice')
  await sheet.getByRole('textbox', { name: /^Nom/ }).fill('Tremblay-Fictive')
  await sheet.getByRole('textbox', { name: /^Courriel/ }).fill('alice.fictive@exemple.test')
  await expect(sheet.getByText("Ce client a déjà un dossier : ouvrez-le plutôt que d'en créer un autre.")).toBeVisible()
  await expect(sheet.getByRole('link', { name: 'Ouvrir le dossier existant' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Créer le dossier' })).toHaveAttribute('aria-disabled', 'true')

  // Another person: the warning goes, the file is created and opened.
  await sheet.getByRole('textbox', { name: /^Prénom/ }).fill(firstName)
  await sheet.getByRole('textbox', { name: /^Nom/ }).fill('Fictif')
  await sheet.getByRole('textbox', { name: /^Courriel/ }).fill(`essai.${stamp}@exemple.test`)
  await expect(sheet.getByText("Ce client a déjà un dossier : ouvrez-le plutôt que d'en créer un autre.")).toBeHidden()
  await sheet.getByRole('button', { name: 'Créer le dossier' }).click()
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/apercu$/)
  await expect(page.getByRole('heading', { level: 1, name: `${firstName} Fictif` })).toBeVisible()
  await expect(page.getByText('Dossier créé.')).toBeVisible()

  // « Proches »: Marc is the parent, manages the appointments and receives the invoices.
  await page.getByRole('tab', { name: 'Proches' }).click()
  await expect(page).toHaveURL(/\/proches$/)
  await page.getByRole('button', { name: 'Ajouter un proche' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Ajouter un proche' })
  await dialog.getByRole('searchbox', { name: /^Proche/ }).fill('Gagnon-Fictif')
  await dialog.getByRole('list', { name: 'Dossiers trouvés' }).getByRole('button', { name: /Marc Gagnon-Fictif/ }).click()
  await dialog.getByLabel(/^Ce proche est/).selectOption({ label: 'Parent' })
  const marcRights = dialog.getByRole('group', { name: /^Ce que Marc Gagnon-Fictif peut faire/ })
  await marcRights.getByRole('checkbox', { name: 'Gère les rendez-vous et formulaires' }).click()
  await marcRights.getByRole('checkbox', { name: 'Reçoit les reçus et factures' }).click()
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Proche enregistré.')).toBeVisible()
  const row = page.getByRole('table', { name: 'Proches du client' }).getByRole('row').filter({ hasText: 'Marc Gagnon-Fictif' })
  await expect(row).toContainText('Parent')
  await expect(row).toContainText('Gère les rendez-vous et formulaires')
  await expect(row).toContainText('Reçoit les reçus et factures')

  // Leave the database as found: archive the new file.
  await page.getByRole('button', { name: 'Archiver' }).click()
  await expect(page.getByText('Dossier archivé.')).toBeVisible()
})

test('a professional sees « Mes clients », never the clinic list', async ({ page, signIn }) => {
  await signIn('provider')
  await page.goto('/mes-clients')
  await expect(page.getByRole('heading', { level: 1, name: 'Mes clients' })).toBeVisible()
  await expect(page.getByText('Alice Tremblay-Fictive')).toBeVisible()
  await expect(page.getByText('Léa Gagnon-Fictive')).toBeVisible()
  await expect(page.getByText('Marc Gagnon-Fictif')).toBeHidden()
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Clients', exact: true })).toBeHidden()
})

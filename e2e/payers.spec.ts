import { expect, test } from './fixtures/auth'

/**
 * Facturation FP, third-party payers (local only, after `npm run db:reset`: the seed enables
 * Facturation; the migration made the clinic's IVAC at 94,50 $ per session).
 *
 * 1. The admin reads IVAC's rate in Paramètres → Payeurs tiers and adds a PAE provider; it is then
 *    one of the organisations of « Payeurs tiers ».
 * 2. The adjointe opens « Payeurs tiers » from the menu, finds IVAC, then « Payeurs à compléter ».
 */

test('the admin reads IVAC’s rate and adds a PAE provider, found in « Payeurs tiers »', async ({ page, signIn }) => {
  const name = `E2E Fournisseur ${Date.now() % 100000}`
  await signIn('admin')
  await page.goto('/parametres/payeurs-tiers')
  await expect(page.getByRole('heading', { level: 1, name: 'Payeurs tiers' })).toBeVisible()
  await expect(page.getByText('Tarif actuel : 94,50 $ par séance')).toBeVisible()
  await page.getByRole('button', { name: 'Ajouter un fournisseur de PAE' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ajouter un fournisseur de PAE' })
  await dialog.getByLabel(/^Nom/).fill(name)
  await dialog.getByLabel(/^Courriel de facturation/).fill('factures@fournisseur.test')
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('Organisme enregistré.')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: name })).toContainText('Par tranches')
  await page.goto('/facturation/payeurs')
  await expect(page.getByRole('region', { name })).toContainText('Factures à factures@fournisseur.test')
})

test('the adjointe opens « Payeurs tiers », then « Payeurs à compléter »', async ({ page, signIn }) => {
  await signIn('adminAssistant')
  await page.getByRole('link', { name: 'Payeurs tiers' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Payeurs tiers' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'IVAC' })).toBeVisible()
  await page.getByRole('link', { name: /^Voir les payeurs à compléter/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Payeurs à compléter' })).toBeVisible()
})

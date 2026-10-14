import { expect, test } from './fixtures/auth'

/**
 * Facturation FP, third-party payers (local only, after `npm run db:reset`: the seed enables
 * Facturation; the migration made the clinic's IVAC at 94,50 $ per session).
 *
 * 1. The admin reads IVAC's rate in Paramètres → Payeurs tiers and adds a PAE provider; it is then
 *    one of the organisations of « Payeurs tiers ».
 * 2. The adjointe opens « Payeurs tiers » from the menu, finds IVAC (its upload portal, R-84), then
 *    « Payeurs à compléter ».
 * 3. R-84, R-85: Inès's IVAC file shows its event date; the adjointe gives Paule a tiered PAE, read
 *    back in plain French on its card, then ends it (a second run adds it again).
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
  // R-84: IVAC takes its invoices on its portal (the seed's fictitious one), not by email.
  await expect(page.getByRole('region', { name: 'IVAC' }).getByRole('link', { name: 'Dépôt sur le portail' })).toHaveAttribute(
    'href',
    'https://portail-ivac.exemple.test/depot',
  )
  await page.getByRole('link', { name: /^Voir les payeurs à compléter/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Payeurs à compléter' })).toBeVisible()
})

test('an IVAC file’s event date (R-84); a PAE agreement with tiers (R-85)', async ({ page, signIn }) => {
  await signIn('adminAssistant')
  await page.goto('/clients')
  await page.getByRole('link', { name: /Inès Côté-Fictive/ }).first().click()
  await page.getByRole('tab', { name: 'Assurance et payeurs' }).click()
  await expect(page.getByText('15 janvier 2026')).toBeVisible()

  await page.goto('/clients')
  await page.getByRole('link', { name: /Paule Roy-Fictive/ }).first().click()
  await page.getByRole('tab', { name: 'Assurance et payeurs' }).click()
  await page.getByRole('button', { name: 'Ajouter un payeur' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ajouter un payeur' })
  await dialog.getByLabel(/^Type/).selectOption('pae')
  await dialog.getByLabel(/^Fournisseur du PAE/).fill('Fournisseur E2E')
  await dialog.getByLabel(/^Numéro de dossier/).fill(`PAE-E2E-${Date.now() % 100000}`)
  await dialog.getByRole('button', { name: 'Ajouter un palier' }).click()
  await dialog.getByLabel(/^Palier 1 · Séances/).fill('3')
  await dialog.getByLabel(/^Palier 1 · Part couverte/).fill('100')
  await dialog.getByLabel(/^Ce que le PAE paie ensuite/).selectOption('percent')
  await dialog.getByLabel(/^Part couverte/).fill('50')
  await dialog.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByText('3 premières séances : 100 % ; ensuite : 50 %').first()).toBeVisible()
  await page.getByRole('button', { name: 'Terminer' }).first().click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Terminer' }).click()
  await expect(page.getByRole('button', { name: 'Ajouter un payeur' })).toBeVisible()
})
